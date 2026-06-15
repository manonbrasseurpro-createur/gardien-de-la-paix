# Entraînement Gardien de la Paix

Site d'entraînement au concours GPX : psychotechniques, culture, cas pratiques, etc.

## Comptes et abonnement

- **Compte obligatoire** pour accéder aux modules (nom, prénom, e-mail, téléphone, mot de passe).
- **Sans abonnement** : **1 petit test gratuit** (mini test ou question isolée en cas pratiques).
- **Avec abonnement** (19,90 €/mois) : simulations complètes, tous les modes, page Ma progression.

Pages : `compte.html` (inscription / connexion), `tarifs.html` (paiement Stripe), `confirmation.html` (après paiement).

## Production : Supabase + Stripe

### 1. Supabase (authentification)

1. Créer un projet sur [supabase.com](https://supabase.com).
2. Exécuter le script `supabase/schema.sql` dans l'éditeur SQL.
3. Renseigner `supabase-config.js` (URL + clé publishable).
4. Dans Authentication → Providers, activer **Email** (mot de passe).

### 2. Stripe (abonnement 19,90 €/mois)

#### A. Créer un produit Stripe (optionnel)

Vous pouvez créer un prix récurrent **19,90 €/mois** dans le Dashboard Stripe et copier le **Price ID** (`price_...`).

Sinon, l'Edge Function crée automatiquement un prix à 19,90 € si `STRIPE_PRICE_ID` n'est pas défini.

#### B. Déployer les Edge Functions

Installer le [Supabase CLI](https://supabase.com/docs/guides/cli), puis :

```bash
supabase login
supabase link --project-ref ivrafclenoukjhmubrgq
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set SITE_URL=https://votre-domaine.fr
# Optionnel si vous avez créé un prix dans Stripe :
supabase secrets set STRIPE_PRICE_ID=price_...
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

1. L'utilisateur clique **S'abonner** sur `tarifs.html`.
2. L'API `create-checkout-session` crée une session Stripe Checkout (19,90 €/mois).
3. Après paiement → redirection vers `confirmation.html`.
4. Le webhook `stripe-webhook` active l'abonnement dans `profiles` (`subscription_status = active`).

### 4. Hébergement

Déployer les fichiers statiques (GitHub Pages, Netlify, OVH, etc.). Aucun build requis.

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `auth-service.js` | Inscription, connexion, profil |
| `stripe-service.js` | Lance le checkout Stripe |
| `access-control.js` | Grille petits tests / abonnement, paywall |
| `supabase-config.js` | Clés Supabase et affichage tarifs |
| `tarifs.html` | Bouton S'abonner |
| `confirmation.html` | Page après paiement |
| `supabase/functions/create-checkout-session` | API création session Stripe |
| `supabase/functions/stripe-webhook` | Webhook activation abonnement |
| `supabase/schema.sql` | Table `profiles` |
