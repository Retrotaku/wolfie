# Wolfie

Base du jeu de Loup-Garou : lobby local sur un appareil et salons en ligne rejoignables par code. Une partie compte de 6 à 14 joueurs. Avant le lancement, la personne hôte peut ajuster la proposition de rôles ; les cartes spéciales ne sont jamais dupliquées, et le nombre de loups et de villageois reste équilibré (avec un villageois de plus si le total restant est impair).

Les pseudos sont limités à 10 caractères et leur première lettre est automatiquement mise en majuscule.

La proposition de base est la suivante :

| Joueurs | Rôles spéciaux | Loups | Villageois |
| --- | --- | --- | --- |
| 6 | Voyante, Sorcière | 2 | 2 |
| 7 | Voyante, Sorcière | 2 | 3 |
| 8 | Voyante, Sorcière | 3 | 3 |
| 9 | Voyante, Sorcière, Cupidon | 3 | 3 |
| 10 | Voyante, Sorcière, Cupidon | 3 | 4 |
| 11 | Voyante, Sorcière, Cupidon | 4 | 4 |
| 12 | Voyante, Sorcière, Cupidon, Chasseur | 4 | 4 |
| 13 | Voyante, Sorcière, Cupidon, Chasseur | 4 | 5 |
| 14 | Voyante, Sorcière, Cupidon, Chasseur | 5 | 5 |

Le Loup Enragé est proposé à partir de 9 joueurs et le Loup Blanc à partir de 12. Ces variantes remplacent des Loups-Garous ordinaires dans la meute. Les réglages de rôles peuvent être changés par l’hôte avant le lancement ; toute place libérée par un rôle spécial non sélectionné est redistribuée à égalité entre loups et villageois, avec un villageois supplémentaire si besoin.

Les personnages principaux du jeu restent limités à : Villageois, Loup-Garou, Loup Enragé, Loup Blanc, Voyante, Sorcière, Cupidon et Chasseur. Les autres personnages disponibles dans la banque de cartes sont classés premium et ne font pas partie de la composition standard. Les règles et l'ordre des actions sont détaillés dans [REGLES.md](./REGLES.md).

## Lancer en local

Depuis le dossier `Wolfie`, installe Flask et démarre le serveur :

```powershell
py -m pip install -r requirements.txt
py app.py
```

Ouvre <http://127.0.0.1:5001>.

En mode local, saisis de six à quatorze noms, un par ligne. En mode en ligne, la personne hôte crée un salon et partage son code ; les autres joueurs ouvrent l’adresse du serveur et rejoignent ce code. Au lancement, les rôles sont mélangés. En local, les joueurs découvrent leur carte à tour de rôle sur l’appareil partagé ; en ligne, chacun ne reçoit que son propre rôle.

## Salons en ligne

Le serveur doit rester allumé et être accessible par tous les joueurs. Pour des joueurs hors du réseau local, il faut déployer Wolfie sur un serveur public accessible en HTTPS. Les salons et leurs participants sont conservés en mémoire : ils disparaissent au redémarrage du serveur. Les tours nocturnes, les pouvoirs principaux, les votes, les liens amoureux, les morts du Chasseur et les conditions de victoire sont gérés. Une narration du maître du jeu accompagne les phases et les résultats, avec des consignes privées pour les actions secrètes. Les rôles premium ne sont pas activés.

## Déployer sur GitHub + Render

Le dépôt est maintenant prêt pour une publication publique.

1. Connecte-toi à GitHub dans le terminal :

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" auth login
```

2. Crée le dépôt GitHub et pousse le projet :

```powershell
git remote add origin https://github.com/<ton-user>/wolfie.git
git branch -M main
git push -u origin main
```

Ou, si tu veux le créer directement depuis GitHub CLI :

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" repo create wolfie --public --source=. --remote=origin --push
```

3. Sur Render, crée un service Web à partir de ce dépôt et sélectionne `render.yaml`.
4. L’application sera accessible sur une URL publique Render, compatible avec les salons en ligne.

## Comptes joueurs et profils Supabase

Les comptes utilisent Supabase Auth (e-mail et mot de passe) et les profils sont enregistrés dans PostgreSQL. Le profil comprend un pseudo de 10 caractères maximum et une bio facultative de 280 caractères maximum. La création de compte ne bloque pas les parties anonymes. Après connexion, le pseudo du profil est proposé automatiquement comme nom d’hôte ou de joueur en ligne.

1. Crée un projet Supabase et ouvre son éditeur SQL.
2. Exécute [`supabase/schema.sql`](./supabase/schema.sql) pour créer la table `profiles`, ses politiques RLS et le déclencheur qui crée le profil après l’inscription.
3. Copie `SUPABASE_URL` et la clé publique `anon`/publishable du projet dans `.env`, à partir de `.env.example`. Ne mets jamais la clé `service_role` dans l’application.
4. Dans les paramètres d’authentification Supabase, configure l’envoi de courriels de confirmation et l’URL du site correspondant à Wolfie.
5. Pour Render, renseigne `SUPABASE_URL` et `SUPABASE_ANON_KEY` dans les variables d’environnement du service.

Les jetons Supabase restent côté serveur dans une session HTTP-only. Les sessions de connexion sont en mémoire et demandent une nouvelle connexion après un redémarrage du serveur ; les profils, eux, restent conservés dans Supabase. Les salons de jeu restent également en mémoire.
