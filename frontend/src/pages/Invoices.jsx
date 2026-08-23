/* The receipts for everything this account has paid for.
 *
 * Invoices are emailed when the payment lands, but an email is not a filing
 * system: it gets deleted, filtered, or sent to an address the learner no
 * longer reads. The same receipts live here for as long as the account does.
 *
 * The PDF is fetched as a blob rather than linked directly, because the
 * download endpoint is authenticated by cookie and a plain <a href> would
 * open it as a navigation — which works until a browser stops sending
 * credentials on cross-site navigations, and then quietly serves a 401 page
 * named invoice.pdf.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DownloadSimple, Receipt } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { BackLink } from '../components/shared';
import { formatPrice } from '../lib/plans';
import { Seo } from '../lib/seo';

export default function Invoices() {
  const t = useT();
  const { user } = useAuth();
  const [invoices, setInvoices] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!user) return;
    api.get('/api/billing/invoices')
      .then(({ data }) => setInvoices(data.invoices || []))
      .catch(() => { setInvoices([]); toast.error(t('inv.failed')); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const download = async (inv) => {
    if (busy) return;
    setBusy(inv.invoice_id);
    try {
      const { data } = await api.get(inv.download_url, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${inv.number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick: releasing it synchronously can cancel the
      // download in Safari before it has read the blob.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error(errMsg(err, t('inv.failed')));
    } finally {
      setBusy('');
    }
  };

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-gray-600">{t('inv.loginPrompt')}</p>
        <Link to="/login" className="btn-primary mt-4 inline-flex">{t('auth.loginButton')}</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Seo titleKey="inv.title" path="/invoices" noindex />
      <BackLink to="/dashboard" />
      <h1 className="font-heading text-3xl font-extrabold text-gray-900">{t('inv.title')}</h1>
      <p className="mt-2 text-sm text-gray-600">{t('inv.subtitle')}</p>

      {invoices === null && (
        <div className="mt-10 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-primary" />
        </div>
      )}

      {invoices?.length === 0 && (
        <div className="card mt-8 flex flex-col items-center gap-3 p-10 text-center">
          <Receipt size={32} className="text-primary" />
          <p className="text-sm text-gray-600">{t('inv.empty')}</p>
          <Link to="/pricing" className="btn-outline mt-1">{t('pay.seePlans')}</Link>
        </div>
      )}

      {Boolean(invoices?.length) && (
        <div className="card mt-8 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-bold uppercase tracking-wide text-gray-500">
                <th className="px-5 py-4">{t('inv.number')}</th>
                <th className="px-5 py-4">{t('inv.date')}</th>
                <th className="px-5 py-4">{t('inv.plan')}</th>
                <th className="px-5 py-4 text-right">{t('inv.total')}</th>
                <th className="px-5 py-4" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.invoice_id} className="border-b border-gray-50 last:border-0"
                  data-testid={`invoice-${inv.number}`}>
                  <td className="px-5 py-4 font-heading font-bold text-gray-900">{inv.number}</td>
                  <td className="px-5 py-4 text-gray-600">
                    {inv.issued_at ? new Date(inv.issued_at).toLocaleDateString() : ''}
                  </td>
                  <td className="px-5 py-4 text-gray-600">{inv.plan_name}</td>
                  {/* The total, with the fee that made it up spelled out under
                      it — the same three figures the checkout showed. */}
                  <td className="px-5 py-4 text-right">
                    <span className="font-heading font-bold tabular-nums text-gray-900">
                      {formatPrice(inv.total, inv.currency)}
                    </span>
                    {Boolean(inv.fee_amount) && (
                      <span className="block text-[11px] text-gray-400">
                        {formatPrice(inv.base_amount, inv.currency)}
                        {' + '}
                        {formatPrice(inv.fee_amount, inv.currency)}
                        {' '}({inv.fee_percent}%)
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button onClick={() => download(inv)} disabled={Boolean(busy)}
                      className="btn-outline !px-3 !py-2 text-xs disabled:opacity-60"
                      data-testid={`download-${inv.number}`}>
                      <DownloadSimple size={15} /> {t('inv.download')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
