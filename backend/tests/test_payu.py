"""PayU hosted-checkout signing and callback parsing."""
import hashlib

import server as m


def _response_hash(fields):
    values = [
        fields.get("additionalCharges", ""), m.PAYU_SALT,
        fields["status"], "", "", "", "", "", "", "", "", "", "",
        fields["email"], fields["firstname"], fields["productinfo"],
        fields["amount"], fields["txnid"], fields["key"],
    ]
    return hashlib.sha512("|".join(values).encode()).hexdigest()


def test_request_hash_uses_payu_form_order(monkeypatch):
    monkeypatch.setattr(m, "PAYU_KEY", "merchant-key")
    monkeypatch.setattr(m, "PAYU_SALT", "merchant-salt")
    fields = {
        "txnid": "sub_123", "amount": "82.39", "productinfo": "1 Month",
        "firstname": "Marie", "email": "marie@example.com",
    }
    expected = hashlib.sha512(
        "merchant-key|sub_123|82.39|1 Month|Marie|marie@example.com|||||||||||merchant-salt"
        .encode()).hexdigest()
    assert m.payu_request_hash(fields) == expected


def test_response_hash_rejects_tampering(monkeypatch):
    monkeypatch.setattr(m, "PAYU_KEY", "merchant-key")
    monkeypatch.setattr(m, "PAYU_SALT", "merchant-salt")
    fields = {
        "status": "success", "email": "marie@example.com", "firstname": "Marie",
        "productinfo": "1 Month", "amount": "82.39", "txnid": "sub_123",
        "key": "merchant-key", "mihpayid": "pay_123",
    }
    fields["hash"] = _response_hash(fields)
    assert m.verify_payu_response(fields)
    fields["amount"] = "1.00"
    assert not m.verify_payu_response(fields)


def test_response_hash_rejects_another_merchant_key(monkeypatch):
    monkeypatch.setattr(m, "PAYU_KEY", "merchant-key")
    monkeypatch.setattr(m, "PAYU_SALT", "merchant-salt")
    fields = {
        "status": "success", "email": "marie@example.com", "firstname": "Marie",
        "productinfo": "1 Month", "amount": "82.39", "txnid": "sub_123",
        "key": "other-key",
    }
    fields["hash"] = _response_hash(fields)
    assert not m.verify_payu_response(fields)


def test_success_callbacks_share_one_idempotency_key(monkeypatch):
    monkeypatch.setattr(m, "PAYU_KEY", "merchant-key")
    monkeypatch.setattr(m, "PAYU_SALT", "merchant-salt")
    fields = {
        "status": "success", "amount": "82.39", "txnid": "sub_123",
        "mihpayid": "pay_123",
    }
    a = m._parse_payu_response(fields)
    b = m._parse_payu_response({**fields, "mihpayid": "pay_123"})
    assert a["event_key"] == b["event_key"] == "payu:paid:sub_123"
    assert a["our_id"] == "sub_123"
    assert a["amount"] == 82.39

class _User:
    name = "Marie Curie"
    email = "marie@example.com"
    phone = "9999999999"
    user_id = "u_1"


def test_form_sends_the_plan_price_and_the_fee_beside_it(monkeypatch):
    """PayU can only itemise what arrives as two fields, not one total."""
    monkeypatch.setattr(m, "PAYU_KEY", "merchant-key")
    monkeypatch.setattr(m, "PAYU_SALT", "merchant-salt")
    monkeypatch.setattr(m, "PAYU_CHARGE_METHODS", ["CC", "DC", "UPI"])
    bill = {"base_amount": 10.0, "total": 10.30}

    fields = m._payu_form("sub_1", "week", bill, _User())

    # Not 10.30: the page would have nothing left to break out.
    assert fields["amount"] == "10.00"
    assert fields["additional_charges"] == "CC:0.30,DC:0.30,UPI:0.30"


def test_no_fee_leaves_the_form_as_it_was(monkeypatch):
    monkeypatch.setattr(m, "PAYU_KEY", "merchant-key")
    monkeypatch.setattr(m, "PAYU_SALT", "merchant-salt")
    bill = {"base_amount": 10.0, "total": 10.0}

    fields = m._payu_form("sub_1", "week", bill, _User())

    assert fields["amount"] == "10.00"
    assert "additional_charges" not in fields


def test_charges_are_hashed_after_the_salt(monkeypatch):
    """The whole point. Hashed the plain way, PayU ignores the charge."""
    monkeypatch.setattr(m, "PAYU_KEY", "merchant-key")
    monkeypatch.setattr(m, "PAYU_SALT", "merchant-salt")
    fields = {
        "txnid": "sub_123", "amount": "10.00", "productinfo": "1 Week",
        "firstname": "Marie", "email": "marie@example.com",
        "additional_charges": "CC:0.30",
    }
    expected = hashlib.sha512(
        "merchant-key|sub_123|10.00|1 Week|Marie|marie@example.com"
        "|||||||||||merchant-salt|CC:0.30".encode()).hexdigest()

    assert m.payu_request_hash(fields) == expected
    # And the two hashes must differ, or the charge rode along unsigned.
    plain = {k: v for k, v in fields.items() if k != "additional_charges"}
    assert m.payu_request_hash(plain) != expected


def test_response_verifies_with_or_without_the_charge_column(monkeypatch):
    """PayU's docs do not say which sequence an empty charge takes.

    Rejecting the wrong guess is money taken with premium never granted, so
    both are accepted - each is still signed with the salt.
    """
    monkeypatch.setattr(m, "PAYU_KEY", "merchant-key")
    monkeypatch.setattr(m, "PAYU_SALT", "merchant-salt")
    base = {
        "status": "success", "email": "marie@example.com", "firstname": "Marie",
        "productinfo": "1 Week", "amount": "10.30", "txnid": "sub_123",
        "key": "merchant-key",
    }
    tail = [
        m.PAYU_SALT, base["status"], "", "", "", "", "", "", "", "", "", "",
        base["email"], base["firstname"], base["productinfo"], base["amount"],
        base["txnid"], base["key"],
    ]

    generic = dict(base)
    generic["hash"] = hashlib.sha512("|".join(tail).encode()).hexdigest()
    assert m.verify_payu_response(generic)

    charged = dict(base, additionalCharges="CC:0.30")
    charged["hash"] = hashlib.sha512(
        "|".join(["CC:0.30"] + tail).encode()).hexdigest()
    assert m.verify_payu_response(charged)

    # Neither sequence excuses a tampered amount.
    assert not m.verify_payu_response(dict(charged, amount="1.00"))
    assert not m.verify_payu_response(dict(generic, amount="1.00"))


def test_callback_amount_adds_the_charge_back_on():
    """Otherwise every sale logs an AMOUNT MISMATCH against the plan total."""
    fields = {"status": "success", "txnid": "sub_123", "amount": "10.00",
              "mihpayid": "pay_1", "additionalCharges": "0.30"}

    assert m._parse_payu_response(fields)["amount"] == 10.30
    # Unchanged where PayU adds nothing.
    assert m._parse_payu_response(
        {k: v for k, v in fields.items() if k != "additionalCharges"}
    )["amount"] == 10.00


def test_an_unreadable_charge_does_not_lose_the_payment():
    fields = {"status": "success", "txnid": "sub_123", "amount": "10.00",
              "mihpayid": "pay_1", "additionalCharges": "CC:0.30"}

    assert m._parse_payu_response(fields)["amount"] == 10.00


def test_a_cancel_is_told_apart_from_a_decline():
    """PayU calls both a failure; only unmappedstatus says which."""
    assert m.payu_return_outcome({"status": "success"}) == "success"
    assert m.payu_return_outcome(
        {"status": "failure", "unmappedstatus": "usercancelled"}) == "cancelled"
    assert m.payu_return_outcome(
        {"status": "failure", "unmappedstatus": "dropped"}) == "cancelled"
    # A real decline, and a failure PayU gave no reason for, both read as one.
    assert m.payu_return_outcome(
        {"status": "failure", "unmappedstatus": "failed"}) == "failed"
    assert m.payu_return_outcome({"status": "failure"}) == "failed"
