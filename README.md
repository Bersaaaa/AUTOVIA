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

## SIV / Carte grise (envoi par e-mail vers SBR CARTE GRISE)

1. Exécutez `supabase_siv.sql`.
2. Créez un compte gratuit sur resend.com et vérifiez votre domaine d'envoi.
3. Déployez la fonction :
```
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set SIV_TO_EMAIL=adresse-de-la-boite-sbr-carte-grise
supabase secrets set SIV_FROM_EMAIL="Demandes SIV <siv@votre-domaine.fr>"
supabase functions deploy send-siv-request
```
Dans l'espace agence, onglet « SIV / Carte grise » (ou bouton « Demande SIV » dans un dossier) : créez la demande, ajoutez les pièces, puis « Envoyer à SBR CARTE GRISE ». Le site n'a pas d'accès direct au SIV.

## Espace agence façon Autocerfa

Exécutez `supabase_bureau.sql` (après `supabase_siv.sql`). Onglets : Bureau (dossiers), Stock, Ventes (par mois, marges, export CSV), Factures, Contacts, SIV, Statistique. Le menu ☰ ouvre le reste (entrée rapide, annonces, Cerfa, livre de police, compta, conformité, avis). Chaque dossier a un panneau de documents (devis, bon de commande, import de vos propres factures, attestation, bon de livraison, quitus, affichette pare-brise, Cerfa remplis, SIV, signature).

## Liens partenaires (financement, garantie, assurance)

Dans `index.html`, bloc `SITE`, renseignez `links:{financing, warranty, insurance}`. Le bouton « Envoyer la demande de financement » copie le récapitulatif du dossier puis ouvre le lien (par défaut `https://www.lenbox.fr`, non vérifié : remplacez-le par votre lien professionnel). Aucune transmission automatique n'est faite vers le partenaire.

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

## Nouveautés (alertes, carte grise publique, simulateur, sauvegarde)
- **Bureau → « À traiter »** : relances de dossiers (7 j sans activité), acomptes en attente (14 j), ventes sans facture importée, garanties du garage qui expirent (30 j), stock > 60 j, prix d'achat manquants, demandes SIV en brouillon.
- **Page publique `/carte-grise`** : le formulaire appelle la fonction `public-carte-grise` (`supabase functions deploy public-carte-grise --no-verify-jwt`, mêmes secrets que `send-siv-request`, dont `SIV_TO_EMAIL` = boîte SBR CARTE GRISE). La demande est aussi enregistrée dans l'onglet SIV (limite : 30 demandes/heure, champ anti-robot).
- **Simulateur de mensualité** sur les fiches véhicule : taux d'exemple dans `SITE.sim` à remplacer. Mentions de crédit à faire valider (À VÉRIFIER).
- **Photos** : flèches ← → pour réordonner, bouton « Mettre en couverture ».
- **Pilotage** : coût réel, marge %, prix conseillé (ESTIMATION selon marge cible et jours en stock), capital immobilisé.
- **Agence → Sauvegarde / export** : JSON complet et CSV par table (les fichiers Storage ne sont pas inclus).

## Identité, mails, agenda, lecture de carte grise, villes
Exécuter `supabase_v12.sql` (paramètres, historique des mails, agenda, demande d'avis).

- **Agence → Paramètres & identité** : nom commercial, raison sociale, forme, capital, SIRET, RCS, TVA, adresse, téléphone, e-mail, médiateur, villes desservies. Ces informations s'impriment sur les documents (devis, bon de commande, certificat de garantie, pochette…) et alimentent les mentions légales et le pied de page. Ne rien inventer : champs vides = « [à compléter] » sur les documents.
- **Photos avec l'appareil** : bouton « Prendre une photo » dans le formulaire d'annonce (sur téléphone, ouvre l'appareil photo).
- **Scan de carte grise par IA** (Entrée rapide) : `supabase functions deploy read-registration` puis `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` (clé API console.anthropic.com, usage facturé à part ; modèle réglable avec `ANTHROPIC_MODEL`). Le titulaire n'est pas lu. Toujours vérifier les champs remplis. La saisie par plaque seule n'existe pas (service de données payant).
- **Mails depuis le dossier** (devis, bon de commande, facture, relance, rendez-vous, remerciement) : `supabase functions deploy send-client-mail`, secrets `RESEND_API_KEY`, `CLIENT_FROM_EMAIL` (ou `SIV_FROM_EMAIL`), `SITE_URL`. Le destinataire est toujours l'e-mail du dossier. Historique dans `deal_mails`.
- **Demande d'avis automatique** : quand un dossier de vente passe à « Livré » (option désactivable dans Paramètres), la fonction `send-client-mail` envoie une seule fois une demande d'avis vers l'espace client. Elle est envoyée quel que soit le sentiment attendu du client : ne filtrez pas les clients satisfaits.
- **Agenda + rappel la veille** : `supabase functions deploy send-reminders --no-verify-jwt`, secrets `CRON_SECRET` + ceux des mails, puis planifier (SQL Editor, extensions pg_cron et pg_net activées) :
  `select cron.schedule('rdv-rappels','0 15 * * *', $$select net.http_post(url:='https://<PROJET>.supabase.co/functions/v1/send-reminders', headers:='{"x-cron-secret":"<CRON_SECRET>"}'::jsonb)$$);`
  (15:00 UTC = 16 h ou 17 h à Paris selon la saison.) Le bouton « Calendrier » d'un rendez-vous télécharge un .ics avec alerte la veille.
- **Pages ville** `/occasion/<ville>` : renseigner les villes dans Paramètres, puis relancer `scripts/generate-sitemap.mjs`. Ne listez que les villes réellement desservies : des pages de villes sans contenu utile peuvent être jugées de faible qualité par Google.

## Cerfa intégrés, recherche globale
- Déposez les PDF officiels remplissables dans `cerfa/` (noms et mode d'emploi : `cerfa/LISEZMOI.txt`). Les boutons Cerfa du dossier téléchargent alors le PDF pré-rempli sans import. Association automatique d'après le nom des champs (à vérifier), ou exacte via `map` dans `cerfa/index.json` (`node scripts/cerfa-fields.mjs` liste les champs). L'import dans « Modèles Cerfa » reste possible et prioritaire.
- L'onglet « Conformité » a été retiré.
- La barre de recherche de l'agence cherche aussi dans les dossiers (nom, plaque, VIN) et les véhicules.

### Cerfa fournis (octobre 2026)
`cerfa/` contient les PDF 15776*01, 13750*07, 13757*03 et 13751*01 avec leurs associations. 15776 et 13757 : champs remplis directement ; 13750 et 13751 (PDF à plat) : texte superposé. Cases à cocher non remplies. À VÉRIFIER : versions en vigueur sur service-public.fr.
