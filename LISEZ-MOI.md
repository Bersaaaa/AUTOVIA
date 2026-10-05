# LISEZ-MOI : tout ce qu'il faut configurer

Projet 100 % à plat : aucun sous-dossier, tous les fichiers sont à la racine (dans GitHub et sur Vercel).
Cochez les cases au fur et à mesure. Le détail technique est dans `README.md`.

---

## 1. Mettre les fichiers en ligne

- [ ] Sur GitHub (`Bersaaaa/AUTOVIA`) : Add file › Upload files › glissez TOUT le contenu du zip décompressé, à la racine. Commit.
- [ ] Vercel redéploie tout seul. Vérifiez que `cerfa_13750.pdf`, `cerfa_13751.pdf`, `cerfa_13757.pdf`, `cerfa_15776.pdf` et les 3 icônes `icon-*.png` sont bien à la racine.
- [ ] `config.js` : copiez `config.example.js` en `config.js`, avec l'URL et la clé « anon / publishable » de votre projet Supabase (Project Settings › API). JAMAIS la clé « service_role ».
- [ ] Sur le téléphone : ouvrez le site, menu du navigateur › « Ajouter à l'écran d'accueil » (installation en application).

## 2. Base de données Supabase (SQL Editor)

Collez et exécutez les fichiers **un par un, dans cet ordre** (relancer un fichier ne casse rien) :

1. [ ] `supabase_schema.sql`
2. [ ] `supabase_espaces.sql`
3. [ ] `supabase_documents.sql`
4. [ ] `supabase_dossiers.sql`
5. [ ] `supabase_cerfa.sql`
6. [ ] `supabase_pilotage.sql`
7. [ ] `supabase_compta.sql`
8. [ ] `supabase_signature_avis.sql`
9. [ ] `supabase_fiche.sql`
10. [ ] `supabase_siv.sql`
11. [ ] `supabase_bureau.sql`
12. [ ] `supabase_v12.sql` (paramètres, agenda, mails)
13. [ ] `supabase_v13.sql` (marge réelle, contrôle technique, relance devis)
14. [ ] `supabase_v14.sql` (archivage des documents d'identité et Cerfa, livre de police modifiable avec historique)

Si une page affiche « exécutez supabase_xxx.sql », c'est qu'un fichier manque dans cette liste.

## 3. Créer votre compte agence

- [ ] Sur le site : « Se connecter › Créer un compte » avec votre e-mail.
- [ ] Dans le SQL Editor, passez-vous administrateur (remplacez l'e-mail) :
  `update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'VOTRE@EMAIL');`
- [ ] Reconnectez-vous : l'espace agence est sur `/agence`.

## 4. Premiers réglages dans le site (Agence › Paramètres)

- [ ] Nom commercial (SBR CAR…), raison sociale, forme juridique, capital, **SIRET**, RCS, TVA, dirigeant, adresse complète (format « 12 avenue X, 92230 Ville »), téléphone, e-mail.
- [ ] **Logo de la société** : imprimé en en-tête de tous les documents (devis, bon de commande, facture, livraison, garantie, attestation, quitus).
- [ ] Mention TVA, conditions générales de vente, délai de livraison, validité des devis : des textes par défaut sont fournis et imprimés ; adaptez-les (CGV et mention TVA à faire valider par un professionnel, À VÉRIFIER).
- [ ] **Tampon + signature** (photo ou PNG) : imprimé sur les devis, bons de commande, factures, garanties… et dans les Cerfa 15776 et 13751.
- [ ] **Logo de l'assureur** (Direct Assurance) et **lien du devis** (à vérifier : par défaut `https://www.direct-assurance.fr`).
- [ ] **Marge minimale** par véhicule (500 € par défaut) : sous ce seuil, une alerte s'affiche.
- [ ] Villes desservies (pour les pages Google par ville) : uniquement les villes réellement desservies.
- [ ] Cases : demande d'avis automatique après livraison (cochée par défaut) ; relance automatique des devis (décochée par défaut).
- [ ] Liens partenaires : financement (Lenbox) et garantie (liens de démo à remplacer dans `index.html`, bloc `SITE.links`).

## 5. Fonctions Supabase (envoi de mails, scan IA, rappels)

Supabase › Edge Functions › « Deploy a new function » : donnez le nom du tableau, collez le contenu du fichier, déployez.

| Fichier | Nom de la fonction | Verify JWT |
|---|---|---|
| `fn-send-siv-request.ts` | `send-siv-request` | activé |
| `fn-estimate-vehicle.ts` | `estimate-vehicle` | activé |
| `fn-read-registration.ts` | `read-registration` | activé |
| `fn-send-client-mail.ts` | `send-client-mail` | activé |
| `fn-public-carte-grise.ts` | `public-carte-grise` | **désactivé** (à REDÉPLOYER : nouvelle version du parcours carte grise) |
| `fn-send-reminders.ts` | `send-reminders` | **désactivé** |

Secrets (Edge Functions › Secrets) :

- [ ] `RESEND_API_KEY` : clé du compte gratuit resend.com (le domaine d'envoi doit être vérifié chez Resend).
- [ ] `CLIENT_FROM_EMAIL` : expéditeur des mails clients, ex. `SBR CAR <contact@votre-domaine.fr>`.
- [ ] `SIV_FROM_EMAIL` : expéditeur des demandes SIV.
- [ ] `SIV_TO_EMAIL` : boîte qui reçoit les demandes SBR CARTE GRISE.
- [ ] `SITE_URL` : adresse du site, ex. `https://autoviza.vercel.app`.
- [ ] `ANTHROPIC_API_KEY` : pour le scan de carte grise / pièce d'identité et l'estimation (console.anthropic.com, usage facturé à part).
- [ ] `CRON_SECRET` : un mot de passe long de votre choix (pour les rappels).

## 6. Rappels automatiques quotidiens

- [ ] Supabase › Database › Extensions : activez `pg_cron` et `pg_net`.
- [ ] SQL Editor (remplacez `<PROJET>` et `<CRON_SECRET>`) :
  `select cron.schedule('rappels','0 15 * * *', $$select net.http_post(url:='https://<PROJET>.supabase.co/functions/v1/send-reminders', headers:='{"x-cron-secret":"<CRON_SECRET>"}'::jsonb)$$);`
- Chaque jour (16 h ou 17 h à Paris) : rappel la veille des rendez-vous, e-mail récapitulatif pour l'agence (devis sans réponse, garanties, contrôles techniques, véhicules qui dorment), et relance des devis si l'option est cochée.

## 7. Les Cerfa

- [ ] Les 4 PDF officiels sont déjà inclus. Versions fournies : 15776\*01, 13751\*01, 13750\*07, 13757\*03.
- [ ] **À VÉRIFIER** sur service-public.fr : la version à jour du 15776 (indiquée *02) et du 13751. Si elle a changé, remplacez le PDF à la racine (même nom) ou importez-le dans Agence › Modèles Cerfa, puis contrôlez le remplissage.
- Cases cochées automatiquement : type de personne, sexe, « céder », « acheté », présence du certificat (OUI par défaut : décochez à la main si besoin). Les déclarations sur l'honneur ne sont jamais cochées. Complétez à la main : heure de vente, numéro de formule.
- Vérifiez TOUJOURS le PDF avant de le signer ou de l'envoyer.

## 8. Le site public

- [ ] Photos : ajoutez vos véhicules (Agence › Stock). Photos prises directement avec l'appareil photo du téléphone.
- [ ] Facultatif, pour Google : lancez `node generate-sitemap.mjs` sur votre ordinateur, puis téléversez `sitemap.xml` à la racine.
- [ ] Mentions légales, CGV, garantie : modèles à faire valider par un professionnel avant usage réel (À VÉRIFIER).

## 9. Test de 10 minutes avant de vous servir du site

1. [ ] Créer un véhicule, puis un dossier de vente, avec prix et prix d'achat : la marge réelle s'affiche en haut du dossier.
2. [ ] Dossier › « Scanner la pièce d'identité » (téléphone) : les champs se remplissent.
3. [ ] Dossier › Cerfa 15776 : le PDF contient les cases cochées et votre tampon.
4. [ ] Dossier › Devis : le tampon et le SIRET sont imprimés.
5. [ ] Dossier › « Envoyer un e-mail au client » avec votre propre adresse.
6. [ ] Agenda : créer un rendez-vous pour demain, puis lancer la fonction `send-reminders` à la main pour voir le mail.
7. [ ] Statistique : le mois affiche le chiffre d'affaires et la marge.

## 9 bis. Documents archivés et livre de police
- Dossier › « Documents archivés » : pièce d'identité, carte grise, Cerfa achat / vente, autre. Les Cerfa générés et les photos scannées sont archivés automatiquement ; vous pouvez aussi importer un fichier (appareil photo ou PDF). Stockage PRIVÉ, réservé à l'agence. Ils apparaissent aussi dans la fiche du véhicule.
- RGPD (À VÉRIFIER) : fixez une durée de conservation (le livre de police se conserve en général 5 ans) et supprimez les pièces d'identité au-delà.
- Livre de police : ✎ modifier, ⊖ supprimer. Chaque changement est gardé dans l'historique en bas de page. Préférez corriger plutôt que supprimer.

## 9 ter. Page publique « Carte grise » (duplicata et changement d'adresse)
- Adresse du site : `/carte-grise` (parcours : démarche › particulier ou société › informations › documents envoyés depuis le téléphone › récapitulatif du prix › envoi) et `/suivi-carte-grise` (suivi par numéro de dossier + e-mail, avec envoi des pièces manquantes).
- Aucun paiement en ligne : le client reçoit un lien de paiement de votre part après vérification (Stripe n'est pas branché ici).
- [ ] Redéployez `fn-public-carte-grise.ts` (Verify JWT désactivé) ; secrets `RESEND_API_KEY`, `SIV_TO_EMAIL`, `SIV_FROM_EMAIL`, `SITE_URL`.
- [ ] Prix : Paramètres › « Carte grise : prix… » (50 € duplicata et 25 € changement d'adresse par défaut, repris de SBR CARTE GRISE). Frais de l'État affichés : 13,76 € pour un duplicata, 0 € pour un changement d'adresse : **À VÉRIFIER** sur service-public.gouv.fr avant mise en ligne.
- Les demandes arrivent dans Agence › SIV avec leurs pièces (cliquez sur une pièce pour l'ouvrir) et un e-mail est envoyé à `SIV_TO_EMAIL`.
- Habilitation : les démarches passent par un prestataire habilité (ePlaque Pro). Renseignez son nom dans Paramètres › « prestataire habilité » : il s'affiche sur la page. Gardez le mandat signé du client dans le dossier (le Cerfa 13757 sert de mandat).

## 10. Ce qui n'est PAS fait automatiquement

- Pas de saisie par plaque seule (service de données payant).
- Les estimations (IA, prix conseillé) sont des ESTIMATIONS : vérifiez.
- Fiscalité (TVA sur marge), obligations légales, mentions : à valider avec votre comptable ou un juriste.
- Les mails clients ne partent jamais seuls, sauf les deux options à cocher dans Paramètres (avis après livraison, relance de devis).
