curl -X GET _ml/trained_models/msmarco-MiniLM-L-12-v3 > res.txt


#   docker run -it --rm embedder\
# eland_import_hub_model \
#   --url https://elastic:elastic@localhost:9200/ \
#   --hub-model-id elastic/distilbert-base-uncased-finetuned-conll03-english \
#   --task-type text_embedding \
#   --start 