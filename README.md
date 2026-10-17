# Wolfie

Base du jeu de Loup-Garou : lobby local sur un appareil et salons en ligne rejoignables par code. Une partie compte de 6 à 14 joueurs. Avant le lancement, la personne hôte peut ajuster la proposition de rôles ; les cartes spéciales ne sont jamais dupliquées, et le nombre de loups et de villageois reste équilibré (avec un villageois de plus si le total restant est impair).

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

Les personnages principaux du jeu restent limités à : Villageois, Loup-Garou, Loup Enragé, Loup Blanc, Voyante, Sorcière, Cupidon et Chasseur. Les autres personnages disponibles dans la banque de cartes sont classés premium et ne font pas partie de la composition standard.

## Lancer en local

Depuis le dossier `Wolfie`, installe Flask et démarre le serveur :

```powershell
py -m pip install -r requirements.txt
py app.py
```

Ouvre <http://127.0.0.1:5001>.

En mode local, saisis de six à quatorze noms, un par ligne. En mode en ligne, la personne hôte crée un salon et partage son code ; les autres joueurs ouvrent l’adresse du serveur et rejoignent ce code. Au lancement, les rôles sont mélangés. En local, les joueurs découvrent leur carte à tour de rôle sur l’appareil partagé ; en ligne, chacun ne reçoit que son propre rôle.

## Salons en ligne

Le serveur doit rester allumé et être accessible par tous les joueurs. Pour des joueurs hors du réseau local, il faut déployer Wolfie sur un serveur public accessible en HTTPS. Les salons et leurs participants sont conservés en mémoire : ils disparaissent au redémarrage du serveur. Les rôles sont distribués, mais les tours de nuit, pouvoirs et votes restent à implémenter.
