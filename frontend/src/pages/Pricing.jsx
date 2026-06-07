import { Link } from 'react-router-dom';
import { CheckCircle } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';

const PLANS = [
  { name: 'Bronze', price: '$14.99', duration: '5 days', bonus: '3 AI attempts bonus', grad: 'from-amber-700 to-amber-500', popular: false },
  { name: 'Silver', price: '$29.99', duration: '1 month', bonus: '8 AI attempts bonus', grad: 'from-gray-500 to-gray-400', popular: true },
  { name: 'Gold', price: '$49.99', duration: '2 months', bonus: '15 AI attempts bonus', grad: 'from-yellow-500 to-amber-400', popular: false },
];

const FEATURES = [
  '40 reading practice tests',
  '40 listening practice tests',
  'Oral expression current-events topics',
  'Written expression topics & corrections',
];

const FAQ = [
  ['Que se passe-t-il à la fin de mon abonnement ?', "Votre compte repasse automatiquement en formule gratuite (5 corrections IA par mois). Vos données, votre historique d'erreurs et vos statistiques sont conservés."],
  ['Puis-je changer de formule ?', "Oui, vous pouvez passer à une formule supérieure à tout moment ; la durée restante est ajoutée à votre nouvelle période."],
  ['Y a-t-il un essai gratuit ?', "Chaque compte commence avec 5 corrections IA gratuites par mois, sans carte bancaire."],
  ['Quels moyens de paiement acceptez-vous ?', "Cartes Visa, Mastercard et Amex (paiement en cours d'intégration — les formules sont présentées à titre indicatif)."],
];

export default function Pricing() {
  const { user } = useAuth();
  const cta = user ? '/dashboard' : '/register';

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-center text-4xl font-bold">Choisissez votre pack</h1>
      <p className="mx-auto mt-3 max-w-xl text-center text-gray-600">
        Des formules courtes et intensives pour préparer votre date d'examen TCF Canada.
      </p>

      <div className="mt-12 grid items-center gap-6 md:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.name}
            className={`card relative overflow-hidden ${p.popular ? 'z-10 ring-4 ring-primary md:scale-110' : ''}`}
            data-testid={`plan-${p.name.toLowerCase()}`}>
            <div className="absolute -right-9 top-5 rotate-45 bg-gray-900 px-10 py-1 text-[10px] font-bold tracking-widest text-white">PACK</div>
            {p.popular && (
              <div className="bg-primary py-1.5 text-center text-xs font-bold tracking-wider text-white">MOST POPULAR</div>
            )}
            <div className={`bg-gradient-to-r ${p.grad} px-6 py-7 text-white`}>
              <h2 className="font-heading text-2xl font-bold">{p.name}</h2>
              <p className="mt-2"><span className="font-heading text-4xl font-bold">{p.price}</span><span className="text-white/80"> / {p.duration}</span></p>
              <p className="mt-1 text-sm font-semibold text-white/90">+ {p.bonus}</p>
            </div>
            <ul className="space-y-3 p-6 text-sm">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-green-500" /> {f}
                </li>
              ))}
            </ul>
            <div className="px-6 pb-6">
              <Link to={cta} className={`w-full ${p.popular ? 'btn-primary' : 'btn-outline'}`} data-testid={`plan-cta-${p.name.toLowerCase()}`}>
                Choisir {p.name}
              </Link>
            </div>
          </div>
        ))}
      </div>

      <section className="mx-auto mt-20 max-w-3xl">
        <h2 className="text-center text-2xl font-bold">Questions fréquentes</h2>
        <div className="mt-8 space-y-4">
          {FAQ.map(([q, a]) => (
            <details key={q} className="card group p-5">
              <summary className="cursor-pointer list-none font-heading font-semibold marker:hidden">{q}</summary>
              <p className="mt-3 text-sm leading-relaxed text-gray-600">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="header-gradient mt-16 rounded-3xl px-8 py-12 text-center text-white">
        <h2 className="text-2xl font-bold">Start with 5 free attempts — no credit card required</h2>
        <Link to={cta} className="mt-6 inline-flex rounded-xl bg-white px-6 py-3 font-semibold text-primary transition hover:-translate-y-0.5 hover:shadow-xl" data-testid="pricing-cta">
          {user ? 'Aller au tableau de bord' : 'Créer mon compte gratuit'}
        </Link>
      </section>
    </main>
  );
}
