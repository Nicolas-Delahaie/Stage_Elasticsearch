# Initiailisation docker

## Pre-requis

Initialiser .env

## Etapes

### Installation des serveurs

Executer le docker compose :  
`docker-compose up -d` pour la première initialisation ou `docker-compose start -d`

### Installer le certificat SSL

Lorsque "setup" est terminé,  
Dans le volume certs,  
Copier ca/ca.crt à la racine du projet (CentralStationService/)
