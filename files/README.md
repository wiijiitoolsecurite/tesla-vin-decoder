# Dash Player — client IPTV Xtream Codes pour navigateur Tesla

Application 100% statique (HTML/CSS/JS vanilla, aucune dépendance en dur).
Elle sert d'interface de lecture pour un compte **Xtream Codes** que
l'utilisateur possède déjà — elle ne fournit, ne débloque et n'héberge
aucun contenu par elle-même.

## Arborescence

```
xtream-player/
  index.html         écrans login / app / player (un seul document)
  css/style.css       thème sombre, cibles tactiles larges
  js/storage.js       session, favoris, historique, cache local
  js/api.js           client Xtream Codes (player_api.php)
  js/player.js        wrapper <video>, bascule TS → HLS, reconnexion
  js/app.js           contrôleur (navigation, grilles, lecteur)
```

Aucun bundler, aucune étape de build : les fichiers sont directement
servables tels quels.

## Déploiement (Nginx)

```nginx
server {
    listen 80;
    server_name dash.exemple.com;
    root /var/www/xtream-player;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    # cache long pour les assets statiques versionnés
    location ~* \.(css|js)$ {
        expires 7d;
        add_header Cache-Control "public";
    }
}
```

Le navigateur appelle directement `player_api.php` et les URLs de flux
du serveur Xtream renseigné au login — prévoir que ce serveur autorise
les requêtes CORS depuis le domaine d'hébergement, sinon les appels
`fetch()` échoueront (limitation du serveur Xtream, pas de l'app).

## Limitation navigateur Tesla — MPEG-TS

Le cahier des charges demande de préférer le flux **MPEG-TS brut (.ts)**
à HLS. En pratique :

- Le moteur du navigateur Tesla est basé sur **Chromium**, qui ne sait
  pas démuxer un flux `.ts` brut donné directement en `src` d'un
  `<video>` (seul Safari le fait nativement). Donner l'URL `.ts` seule
  produira donc le plus souvent un écran noir silencieux, sans erreur
  exploitable.
- `player.js` respecte quand même l'ordre de préférence demandé : il
  **tente d'abord l'URL `.ts`** (gratuit si jamais le panel/le moteur
  le supporte), puis, si aucune image n'arrive dans un court délai,
  **bascule automatiquement sur la variante `.m3u8` (HLS)** du même
  canal — chargée via `hls.js`, importé à la volée uniquement quand ce
  repli est réellement nécessaire (jamais sur le cas nominal, pour ne
  rien alourdir par défaut).
- Ce comportement est transparent pour l'utilisateur : seul le message
  de statut ("Passage en HLS…") l'indique brièvement.

## Sécurité et données locales

- Les identifiants ne sont jamais affichés une fois connecté.
- Sans case « Rester connecté » cochée, la session vit en
  `sessionStorage` et disparaît à la fermeture de l'onglet.
- Avec la case cochée, elle est stockée en `localStorage`, encodée en
  base64 (obfuscation d'affichage, pas un chiffrement) pour éviter
  qu'elle saute aux yeux dans les DevTools.
- Le bouton de déconnexion efface la session et le cache d'API. Les
  favoris/l'historique restent sur l'appareil (ce sont des données
  utilisateur locales, pas des identifiants) sauf suppression manuelle
  du stockage du navigateur.

## Limites connues / pistes d'évolution

- L'EPG n'est récupéré qu'à la demande (`get_short_epg`) — pas encore
  affiché dans l'UI, câblage prévu dans `api.js` (`getShortEpg`).
- La recherche interroge la liste complète du tab courant (mise en
  cache) ; pour un compte avec des dizaines de milliers de chaînes,
  prévoir une recherche côté serveur si le panel l'expose.
