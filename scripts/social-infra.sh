#!/usr/bin/env bash
# One-time GCP setup for «Donuts Post» (docs/social-setup.md): media bucket and IAM for signed URLs.
# Idempotent. Run in Cloud Shell: bash scripts/social-infra.sh
set -euo pipefail
P=named-vine-322614
B=gs://$P-social
SA=$(gcloud functions describe staffAction --region=europe-central2 --project=$P --format='value(serviceConfig.serviceAccountEmail)')
echo "functions service account: $SA"

gcloud services enable iamcredentials.googleapis.com --project=$P
gcloud storage buckets describe $B --format='value(name)' 2>/dev/null \
  || gcloud storage buckets create $B --project=$P --location=europe-central2 --uniform-bucket-level-access --public-access-prevention
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}' > /tmp/social-lc.json
gcloud storage buckets update $B --lifecycle-file=/tmp/social-lc.json
gcloud storage buckets add-iam-policy-binding $B --member="serviceAccount:$SA" --role=roles/storage.objectAdmin --format=none
gcloud iam service-accounts add-iam-policy-binding "$SA" --member="serviceAccount:$SA" \
  --role=roles/iam.serviceAccountTokenCreator --project=$P --format=none
echo "social infra ready: $B"
