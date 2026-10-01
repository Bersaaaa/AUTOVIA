# AUTOVIA — version Supabase

## Installation

1. Dans Supabase, créez un projet.
2. Ouvrez SQL Editor.
3. Importez `supabase_schema.sql` et exécutez-le.
4. Copiez `config.example.js` vers `config.js`.
5. Dans `config.js`, renseignez :
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (ou publishable key)
6. Ouvrez `index.html` ou déployez le dossier sur votre hébergement.

## Espaces acheteur et agence

1. Exécutez `supabase_espaces.sql` après `supabase_schema.sql` (comptes acheteurs, favoris, suivi des demandes).
2. Créez le compte de l'agence (Authentication > Users), puis donnez-lui l'accès : voir la dernière ligne du fichier SQL.
3. Le site : `#/compte` (acheteur) et `#/agence` (ajout, modification, statut vendu avec filigrane, suppression).

## Référencement et URL propres

Le site utilise des URL propres (`/acheter`, `/vehicule/mon-slug`). Il faut que l'hébergeur renvoie toutes les pages vers `index.html` :
`_redirects` (Netlify, Cloudflare Pages), `vercel.json` (Vercel) ou `.htaccess` (Apache, OVH). Le site doit être à la racine du domaine.
Remplacez `VOTRE-DOMAINE` dans `robots.txt`, puis générez le plan du site : `SITE_URL=https://... SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/generate-sitemap.mjs`.

## Estimation avec Claude

Déployez la fonction `supabase/functions/estimate-vehicle` (commandes en tête du fichier). Sans elle, le site utilise la formule de démonstration.
Surveillez l'usage de la clé API : la fonction est appelable depuis le site, pensez à fixer une limite de dépenses côté Anthropic.

## Personnalisation

Les coordonnées, horaires, mentions légales et avis Google se renseignent dans le script de `index.html` (bloc `SITE`).
Les pages Mentions légales et le texte des formulaires sont à vérifier avant la mise en ligne.

## Important — sécurité

Dans Supabase > Authentication, désactivez les inscriptions publiques : le trigger `handle_new_user`
donne le rôle `admin` à tout nouvel utilisateur.


La clé `anon` / publishable peut être exposée dans le frontend.
Ne mettez JAMAIS la `service_role` key dans `config.js`.

Les politiques RLS permettent :
- lecture publique uniquement des véhicules publiés et non brouillons ;
- création publique de leads ;
- gestion complète des véhicules et leads uniquement aux utilisateurs staff ;
- lecture publique des photos de véhicules publiés.

Pour créer un administrateur :
1. Créez l'utilisateur dans Supabase Authentication > Users.
2. Le trigger crée automatiquement son profil.
3. Le rôle initial est `admin`.

## Photos

Le bucket public `vehicle-images` est créé par le SQL.
Le back-office pourra uploader les photos, puis enregistrer leur `storage_path`
dans `vehicle_images`.

Le bucket `valuation-images` est privé volontairement. Pour permettre aux visiteurs
d'envoyer des photos sans exposer le stockage, il est recommandé de passer par une
Supabase Edge Function qui valide la demande puis réalise l'upload.

## Architecture recommandée

Frontend :
- HTML/CSS/JS ou migration vers React/Next.js

Backend :
- Supabase PostgreSQL
- Supabase Storage
- Supabase Auth
- Edge Functions pour les traitements sensibles

Tables :
- profiles
- vehicles
- vehicle_images
- leads
- valuation_images

## Prochaine étape production

Ajouter :
- vrai back-office `/admin`
- authentification staff
- upload / suppression de photos
- pagination serveur
- fiche véhicule SEO indexable par slug
- sitemap.xml
- robots.txt
- Schema.org Vehicle/Product + LocalBusiness
- pages locales
- vraie solution de financement
- vraie carte Google Maps
- consentement cookies
- emails automatiques pour les leads
- anti-spam / CAPTCHA ou Turnstile
