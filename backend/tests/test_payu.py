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