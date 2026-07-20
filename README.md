# Entraînement Gardien de la Paix

Site d'entraînement au concours GPX : psychotechniques, culture, cas pratiques, etc.

## Comptes et abonnement

- **Compte obligatoire** pour accéder aux modules (nom, prénom, e-mail, téléphone, mot de passe).
- **Essai gratuit** : **7 jours d'accès complet — sans carte bancaire** (tous les modules et modes).
- **Avec abonnement** (3 formules : 14,90 €/mois récurrent, 29,90 €/3 mois paiement unique, 49,90 €/6 mois paiement unique) : accès illimité, page Ma progression.

Pages : `inscription.html`, `connexion.html`, `compte.html`, `tarifs.html` (paiement Stripe), `confirmation.html` (après paiement).

## Production : Supabase + Stripe

### 1. Supabase (authentification)

1. Créer un projet sur [supabase.com](https://supabase.com).
2. Exécuter le script `supabase/schema.sql` dans l'éditeur SQL.
3. Renseigner `supabase-config.js` (URL + clé publishable).
4. Dans Authentication → Providers, activer **Email** (mot de passe).

### 2. Stripe (3 formules)

#### A. Créer les produits Stripe (optionnel)

Créez les prix dans le Dashboard Stripe et copiez les **Price IDs** (`price_...`) :

| Formule | Prix | Type |
|---------|------|------|
| Mensuel | 14,90 €/mois | Abonnement récurrent |
| Trimestriel | 29,90 €/3 mois | Paiement unique |
| Semestriel | 49,90 €/6 mois | Paiement unique |

Sinon, les Price IDs par défaut sont définis dans `supabase-config.js` et `create-checkout-session`.

#### B. Déployer les Edge Functions

Installer le [Supabase CLI](https://supabase.com/docs/guides/cli), puis :

```bash
supabase login
supabase link --project-ref ivrafclenoukjhmubrgq
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set SITE_URL=https://votre-domaine.fr
# Optionnel si vous avez créé des prix dans Stripe :
supabase secrets set STRIPE_PRICE_MONTHLY=price_...
supabase secrets set STRIPE_PRICE_QUARTERLY=price_...
supabase secrets set STRIPE_PRICE_BIANNUAL=price_...
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook --no-verify-jwt
```

`SITE_URL` = l'URL publique de votre site (sans slash final), utilisée pour les redirections Stripe.

#### C. Configurer le webhook Stripe

Dans Stripe → **Developers → Webhooks → Add endpoint** :

- URL : `https://ivrafclenoukjhmubrgq.supabase.co/functions/v1/stripe-webhook`
- Événements :
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Copier le **Signing secret** (`whsec_...`) dans `STRIPE_WEBHOOK_SECRET`.

#### D. Migration SQL (colonnes Stripe)

Si la table `profiles` existe déjà :

```sql
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
```

### 3. Parcours utilisateur

1. L'utilisateur crée un compte sur `inscription.html` → essai gratuit de 7 jours (sans CB).
2. Après l'essai, ou pour s'abonner directement, il choisit une formule sur `tarifs.html`.
3. L'API `create-checkout-session` crée une session Stripe Checkout pour la formule choisie.
4. Après paiement → redirection vers `confirmation.html`.
5. Le webhook `stripe-webhook` active l'abonnement dans `profiles` (`subscription_status = active`).

### 4. Hébergement

Déployer les fichiers statiques (GitHub Pages, Netlify, OVH, etc.). Aucun build requis.

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `auth-service.js` | Inscription, connexion, profil |
| `stripe-service.js` | Lance le checkout Stripe |
| `access-control.js` | Essai 7 jours / abonnement, paywall, badge nav |
| `supabase-config.js` | Clés Supabase et affichage tarifs |
| `tarifs.html` | Bouton S'abonner |
| `confirmation.html` | Page après paiement |
| `supabase/functions/create-checkout-session` | API création session Stripe |
| `supabase/functions/stripe-webhook` | Webhook activation abonnement |
| `supabase/schema.sql` | Table `profiles` |
