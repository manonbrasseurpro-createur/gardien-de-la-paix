# Entraînement Gardien de la Paix

Site d'entraînement au concours GPX : psychotechniques, culture, cas pratiques, etc.

## Comptes et abonnement

- **Compte obligatoire** pour accéder aux modules (nom, prénom, e-mail, mot de passe).
- **Sans abonnement** : **1 petit test gratuit** (mini test ou question isolée en cas pratiques).
- **Avec abonnement** : simulations complètes, tous les modes, page Ma progression.

Pages : `compte.html` (inscription / connexion), `tarifs.html` (offres).

## Tester en local (sans Supabase)

Par défaut, le site utilise un **mode local** : les comptes sont stockés dans le navigateur (`localStorage`).

1. Ouvrir `compte.html` et créer un compte.
2. Tester un petit test gratuit.
3. Pour simuler un abonnement : **Mon compte → Activer l'abonnement démo**.

## Production : Supabase + Stripe

### 1. Supabase (authentification)

1. Créer un projet sur [supabase.com](https://supabase.com).
2. Exécuter le script `supabase/schema.sql` dans l'éditeur SQL.
3. Renseigner `supabase-config.js` :

```javascript
window.GPX_SUPABASE = {
  url: "https://xxxx.supabase.co",
  anonKey: "votre-clé-anon"
};
```

4. Dans Authentication → Providers, activer **Email** (mot de passe).

### 2. Stripe (paiement)

1. Créer des produits **mensuel** et **annuel** dans Stripe.
2. Créer des **Payment Links** et copier les URLs dans `supabase-config.js` :

```javascript
window.GPX_STRIPE = {
  paymentLinkMonthly: "https://buy.stripe.com/...",
  paymentLinkYearly: "https://buy.stripe.com/..."
};
```

3. Configurer un **webhook** Stripe (événements `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`) qui met à jour la table `profiles` :

   - `subscription_status = 'active'`
   - `subscription_ends_at` selon la période payée

   Le webhook doit utiliser la **clé service role** Supabase (côté serveur uniquement — Edge Function, Vercel, etc.). Le `client_reference_id` du Payment Link contient l'`id` utilisateur Supabase.

### 3. Hébergement

Déployer les fichiers statiques (GitHub Pages, Netlify, OVH, etc.). Aucun build requis.

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `auth-service.js` | Inscription, connexion, profil |
| `access-control.js` | Grille petits tests / abonnement, paywall |
| `supabase-config.js` | Clés Supabase et liens Stripe |
| `supabase/schema.sql` | Table `profiles` et trigger inscription |
