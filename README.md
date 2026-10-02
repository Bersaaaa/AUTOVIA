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

## Documents clients (factures, bons de commande…)

Exécutez `supabase_documents.sql` après les deux autres scripts. L'agence envoie des documents depuis `#/agence?tab=documents` ; chaque client les retrouve dans « Mon compte ». Stockage privé, accès par lien temporaire.

## Dossiers de vente

Exécutez `supabase_dossiers.sql` après `supabase_documents.sql`. Onglet « Dossiers de vente » dans l'espace agence : étapes, pièces à fournir, bon de commande / facture, suivi visible par le client.

## Cerfa automatiques

Exécutez `supabase_cerfa.sql`. Onglet « Cerfa » : importez le PDF officiel remplissable (service-public.fr), associez ses champs aux données une seule fois, puis cliquez sur le nom du Cerfa dans un dossier pour le télécharger prérempli. Vérifiez toujours le document avant signature.

## Pilotage, comparateur, alertes

Exécutez `supabase_pilotage.sql`. Onglet « Pilotage » (CA, marge, stock, jours en stock, saisie des coûts d'achat : table réservée à l'agence). Comparateur sur la fiche véhicule (`#/comparer`). Alertes de recherche dans « Mon compte ».

## Livre de police, compta, conformité

Exécutez `supabase_compta.sql`. Onglets « Livre de police » (ajout seul, export CSV), « Compta » (recettes, dépenses, TVA indicative, export) et « Conformité » (pense-bête). Faites valider le registre électronique avec votre comptable.

## Signature électronique et avis

Exécutez `supabase_signature_avis.sql`. Dossier de vente : « Envoyer le bon de commande à signer » ; le client signe dans « Mon compte ». La preuve (date serveur, empreinte SHA-256, adresse IP, signature) est conservée et le document signé n'est plus modifiable. Avis : déposés par les clients après livraison, publiés après modération (onglet Avis).

## Visibilité Google

Après chaque ajout de véhicule : `SITE_URL=… SUPABASE_URL=… SUPABASE_ANON_KEY=… node scripts/prerender.mjs` puis `node scripts/generate-sitemap.mjs`, et redéployez. Cela crée une page statique par véhicule et par marque (`/marque/Peugeot`). Déclarez ensuite `sitemap.xml` dans Google Search Console. Les résultats dépendent de votre contenu (photos, descriptions) et prennent du temps.

## Photos

Les photos sont réduites (1600 px, WebP) avant envoi. Choisissez la couverture avec « Mettre en couverture ».

## Application (PWA)

`manifest.webmanifest`, `sw.js` et `icons/` doivent être déployés à la racine du site, en HTTPS. Le bandeau « Installer » apparaît tant que l'application n'est pas installée. Remplacez les icônes dans `icons/` par votre logo. Les données (Supabase) ne sont jamais mises en cache hors ligne.

## Fiche véhicule agence

Exécutez `supabase_fiche.sql`. Bouton « Fiche » sur chaque véhicule : identité (immatriculation, VIN), achat, marge, création du dossier de vente, inscription au livre de police, historique des dossiers et documents.

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
