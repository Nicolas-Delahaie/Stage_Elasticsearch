curl \
 -X POST \
"https://localhost:9200/skus/_doc"\
 -u elastic:elastic \
 -k \
 -H 'Content-Type: application/json' \
 -d @documents.json \
 > res.json
