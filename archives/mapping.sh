curl \
 -X PUT \
"https://localhost:9200/skus"\
 -u elastic:elastic \
 -k \
 -H 'Content-Type: application/json' \
 -d @skus_mapping.json \
 > res.json
