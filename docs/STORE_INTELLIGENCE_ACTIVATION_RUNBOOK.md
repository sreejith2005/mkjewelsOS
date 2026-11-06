# Store Intelligence activation runbook (AWS processing + Android pilot)

Owner-run procedure to turn Store Intelligence recording on for **one branch and a
few employees**. It assumes the code, database and Edge Functions on `main` are
already live (checked 2026-11-06, see section 1) and adds only what is missing:
AWS processing, recorder secrets, a benchmark, a signed pilot APK on real phones,
and the pilot switches.

Read first: `AGENTS.md`, `PRODUCTION_SWITCH_PLAYBOOK.md`, `docs/RECORDING_PILOT.md`,
`services/recorder/README.md`, `docs/MOBILE_RELEASE_GUIDE.md`.

**Recording stays OFF until every gate in section 9 is green.** Nothing here is
a reason to insert placeholder URLs, example secrets or test data into production.

## 1. State on 2026-11-06 (verified, read-only)

| Item | State |
| --- | --- |
| JewelOS DB `yimafxhuwgfhvzczqqdd` | Ledger = `main` through `0384`; `db push --dry-run`: up to date |
| CRM DB `fsydcsyqnddacjfoutfe` (`walk-in_crm`) | Ledger = `main` through `20261106000200`; dry run up to date |
| JewelOS functions `recorder-session` (JWT on), `recorder-ingest` (JWT off + `x-recorder-secret`), `crm-customer-sync` | Deployed source byte-identical to `main` |
| CRM functions `sync-receive`, `sync-deliver` | Deployed source byte-identical to `main` |
| Vercel `mkjewels-os` production | `main` `f9d9e136`, `https://mkjewels-os.vercel.app`; bundle holds only anon keys |
| `RECORDER_*` Edge secrets | **None set** -> `recorder-ingest` answers 401 to everything, `recorder-session` cannot issue URLs |
| `recorder_config` | No rows -> capture, analysis and coaching all off; no devices or sessions |
| AWS | No account access, CLI or Terraform on the release machine; nothing provisioned |
| GPU processor + Bedrock analyzer | **Only in open PR #64** (`services/recorder-processor`), not on `main` |
| Android | Native recorder compiles; **no physical-device run yet** |

## 2. How the pieces talk

```text
Phone/browser (JewelOS web, also inside the Android WebView)
  1. POST recorder-session (JewelOS JWT)  ->  SQL recorder_issue_ticket  -> opaque ticket + upload/stream origins
  2. HTTPS/WSS to AWS ingestion (ticket)   ->  ingestion redeems it via recorder-ingest (x-recorder-secret)
  3. Chunks -> S3 (SSE-KMS)  +  receipt via recorder-ingest  -> durable ACK -> phone deletes local bytes
AWS worker      : claim_job via recorder-ingest -> presigned S3 GETs -> GPU processor -> segments/final transcript
AWS analysis    : analysis_claim -> Claude (Bedrock or private gateway) -> analysis_submit (server computes score)
Playback        : recorder-session 'playback' -> single-use audited ticket -> AWS POST /v1/playback -> WAV
CRM             : unchanged two-project outbox (crm-customer-sync -> CRM sync-receive); no AWS involvement
```

AWS never holds a Supabase service-role key or a user JWT. Supabase never holds
an AWS key. The only shared secrets are listed in section 4.

## 3. What the repository provides vs. what is missing

| Need | In the repository | Missing (owner/AWS work) |
| --- | --- | --- |
| Private audio bucket | `services/recorder/infra/storage.tf`: S3, public-access block, TLS-only + KMS-only write policy, lifecycle `recordings/` 1..90 days, abort multipart | Remote encrypted Terraform state; `terraform plan/apply` |
| Encryption | KMS key with rotation; IAM policy scoped to `recordings/*` and `kms:ViaService` S3 | — |
| IAM | Policy attached to an **existing** role (`recorder_role_arn`) | The EC2 role + instance profile; Bedrock and SSM read permissions |
| Ingestion service | `Dockerfile` (Python 3.14, uvicorn on 127.0.0.1:8080), `Caddyfile` (TLS, 90 KB body cap), `/healthz`, `/readyz` | EC2 host, Docker, Caddy, DNS name, public 80/443 |
| Transcription worker | `python production.py` (same image) | Process supervision, the GPU endpoint |
| GPU processor | **PR #64 only**: CUDA 12.4 image, faster-whisper / IndicConformer, pyannote, `bench.py` | Merge PR #64 after review; GPU instance, NVIDIA driver + container toolkit, model volume, Hugging Face token, private TLS load balancer |
| Analysis worker | `python production.py analysis`; PR #64 adds `RECORDER_ANALYZER_KIND=bedrock` | Bedrock model access in-region, IAM permission |
| Queue/retries | PostgreSQL leases in Supabase (5 attempts, back-off, dead letter, `reconcile` each minute) | Optional independent minute scheduler |
| Secrets store | — | SSM Parameter Store SecureString (or Secrets Manager) |
| TLS / DNS | — | Public DNS for ingestion; ACM certificate + private hosted zone for the GPU LB |
| Logging / alerts / cost | Fixed error codes, no audio/text in logs; `/readyz` 503 on attention | CloudWatch agent, alarms, AWS Budget |
| Rollback | Pilot switch in JewelOS; image digests | Keep previous image digest; documented below |

## 4. Variables and secrets (exact names)

Generate each shared secret once (`openssl rand -hex 32`), store it in the AWS
secret store and paste it into the Supabase dashboard (Edge Functions -> Secrets).
Never on a command line, in Git, Terraform, Vercel, the APK, logs or chat.

### JewelOS Supabase (`yimafxhuwgfhvzczqqdd`) Edge Function secrets

| Name | Value | Contract |
| --- | --- | --- |
| `RECORDER_UPLOAD_URL` | `https://<ingest-host>` (origin only, no path) | `recorder-session` refuses anything but bare `https://` origin |
| `RECORDER_STREAM_URL` | `wss://<ingest-host>` | bare `wss://` origin |
| `RECORDER_ALLOWED_ORIGINS` | `https://mkjewels-os.vercel.app` (comma-list; add a custom domain only if one exists) | Browser `Origin` exact match, else 403 |
| `RECORDER_INGEST_SECRET` | shared secret **S1** | Compared in constant time with `x-recorder-secret`; empty = everything 401 |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are platform-provided already.

### CRM Supabase (`fsydcsyqnddacjfoutfe`)

**Nothing new.** The recording -> CRM link uses the existing `CRM_SYNC_*` outbox
secrets, already set on both projects. Do not copy recorder secrets to CRM.

### AWS ingestion + transcription worker + analysis worker (same image)

| Name | Value |
| --- | --- |
| `RECORDER_EDGE_URL` | `https://yimafxhuwgfhvzczqqdd.supabase.co/functions/v1/recorder-ingest` |
| `RECORDER_BACKEND_SECRET` | **S1** (must equal `RECORDER_INGEST_SECRET`) |
| `RECORDER_BUCKET` | Terraform output `bucket` |
| `RECORDER_KMS_KEY_ARN` | Terraform output `kms_key_arn` |
| `RECORDER_ORIGINS` | `https://mkjewels-os.vercel.app` (ingestion only; same list as `RECORDER_ALLOWED_ORIGINS`, separate variable) |
| `RECORDER_GPU_URL` | `https://<gpu-private-host>/v1/transcribe` (worker only) |
| `RECORDER_GPU_TOKEN` | shared secret **S2** (worker only) |
| `RECORDER_GPU_HOSTS` | `<gpu-private-host>` exact (worker only) |
| `RECORDER_FINALIZE_TRANSCRIPTS` | `true` only after migration 0379 path is verified (worker) |
| `RECORDER_COACHING_ENABLED` | leave unset (coaching off for the pilot) |
| `RECORDER_ANALYZER_KIND` | `bedrock` (PR #64) - or set the gateway family below instead |
| `RECORDER_ANALYZER_REGION` | Bedrock region that serves the chosen Claude model |
| `RECORDER_ANALYZER_MODEL` | Bedrock id, default `anthropic.claude-opus-5-5`; confirm it is enabled |
| `RECORDER_ANALYZER_EFFORT` | default `high` |
| `RECORDER_ANALYZER_URL`, `_TOKEN`, `_HOSTS`, `_PROVIDER`, `_MODEL` | Only for a private HTTPS analyzer gateway instead of Bedrock |
| `RECORDER_ANALYZER_FALLBACK_*` | Optional second analyzer (same names with `_FALLBACK`); its use forces manager review |
| `RECORDER_ANALYSIS_JOB_VERSIONS` | `mk-sales-v1` |
| `RECORDER_DOMAIN` | Caddy site name = `<ingest-host>` |

### AWS GPU processor (PR #64)

| Name | Value |
| --- | --- |
| `PROCESSOR_TOKEN` | **S2** (24+ chars, equals `RECORDER_GPU_TOKEN`) |
| `PROCESSOR_AUDIO_HOSTS` | Exact S3 host in the worker's presigned URLs, e.g. `<bucket>.s3.ap-south-1.amazonaws.com` |
| `PROCESSOR_ENGINE` / `PROCESSOR_WHISPER_MODEL` | `whisper` / `large-v3` (decide from the benchmark) |
| `PROCESSOR_LANGUAGES` | `hi,en` |
| `PROCESSOR_DIARIZATION` | `true` |
| `PROCESSOR_HF_TOKEN` | Hugging Face read token after accepting pyannote's terms (secret) |
| `PROCESSOR_TRANSLATE`, `PROCESSOR_COMPUTE_TYPE`, `PROCESSOR_DEVICE` | optional; defaults `false`, `float16`, `cuda` |

Rotation: S1 needs Supabase and AWS changed together (brief 401 window); S2 needs
worker and GPU changed together. Neither touches phones or the web build.

## 5. AWS build, step by step (region `ap-south-1`, same as both Supabase projects)

Install on the operator machine and record versions: AWS CLI v2
(`aws --version`), Terraform >= 1.9 (`terraform version`), Docker. Use an SSO
profile with admin rights for the build only: `aws configure sso --profile mkj-rec`.

### 5.1 Preflight (read-only)

```powershell
$env:AWS_PROFILE='mkj-rec'; $r='ap-south-1'
aws sts get-caller-identity
aws ec2 describe-instance-type-offerings --region $r --location-type availability-zone `
  --filters Name=instance-type,Values=g6.xlarge,g5.xlarge,g4dn.xlarge --query 'InstanceTypeOfferings[].[InstanceType,Location]' --output table
# "Running On-Demand G and VT instances" vCPU quota; a new account is often 0 -> request >= 4 (or 8) first.
aws service-quotas get-service-quota --region $r --service-code ec2 --quota-code L-DB2E81BA
aws bedrock list-foundation-models --region $r --by-provider anthropic --query 'modelSummaries[].modelId'
aws bedrock list-inference-profiles --region $r --query 'inferenceProfileSummaries[].inferenceProfileId'
```

Stop if no GPU type is offered or the quota is 0 (raise it and wait), or if the
chosen Claude model is not available to the account in an acceptable region.
Customer conversations are personal data: the owner approves the Bedrock region
and data-residency terms before any real audio is analysed.

### 5.2 Remote Terraform state (once)

Create a private, versioned, SSE-KMS bucket for state (e.g. `mkj-tfstate-<account>`),
then put the backend in `services/recorder/infra/backend_override.tf` (ignored by Git):

```hcl
terraform {
  backend "s3" {
    bucket       = "mkj-tfstate-<account>"
    key          = "jewelos/recorder/storage.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}
```

### 5.3 Role for the hosts, then storage

```powershell
# EC2 trust policy -> role + instance profile (one role for ingestion/worker/analysis hosts)
aws iam create-role --role-name jewelos-recorder --assume-role-policy-document file://ec2-trust.json
aws iam create-instance-profile --instance-profile-name jewelos-recorder
aws iam add-role-to-instance-profile --instance-profile-name jewelos-recorder --role-name jewelos-recorder
aws iam attach-role-policy --role-name jewelos-recorder --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

cd services/recorder/infra
terraform init
terraform fmt -check; terraform validate
terraform plan -var bucket_name=mkj-recorder-audio-<account> -var recorder_role_arn=<role-arn> -var retention_days=7 -out storage.tfplan
# Review: 1 KMS key, 1 bucket + 5 bucket settings/policy, 1 IAM policy + 1 attachment. Nothing destroyed.
terraform apply storage.tfplan
terraform output
```

Add to the role (inline, least privilege): `ssm:GetParameters` on
`arn:aws:ssm:ap-south-1:<account>:parameter/jewelos/recorder/*` plus `kms:Decrypt`
for the SSM key; and, for Bedrock analysis, `bedrock:InvokeModel` and
`bedrock:InvokeModelWithResponseStream` on the chosen model / inference-profile ARNs only.
The GPU host gets its own role with SSM read for `/jewelos/recorder/gpu/*` and
**no** S3 permission (it reads only presigned URLs).

### 5.4 Secrets

```powershell
# Enter values interactively from a password manager; never type them inline in shell history.
aws ssm put-parameter --name /jewelos/recorder/backend_secret --type SecureString --value (Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText)
```

Repeat for `/jewelos/recorder/gpu_token` (S2, read by the worker host) and, under the GPU
host's own path, `/jewelos/recorder/gpu/token` (the same S2) and `/jewelos/recorder/gpu/hf_token`;
each role reads only its own path. (PowerShell 7 for `-AsPlainText`.) Non-secret
values (URLs, bucket, hosts) go in plain `String` parameters.

### 5.5 Network

- VPC with one public subnet (ingestion host) and one private subnet (GPU host).
- S3 **gateway** VPC endpoint on both route tables (free; S3 traffic stays private).
- Security groups: ingestion `443` + `80` (ACME) from the internet, no `8080`;
  GPU LB `443` only from the ingestion host's security group; GPU host `8443` only
  from the LB; no SSH anywhere (use SSM Session Manager).
- The GPU host needs outbound HTTPS once to download model weights (NAT for the
  first start, or bake the weights into the `/models` EBS volume and remove NAT).

### 5.6 GPU processor host (after PR #64 is merged)

- AMI: AWS Deep Learning Base GPU AMI (Ubuntu) - NVIDIA driver and
  `nvidia-container-toolkit` preinstalled; verify with `nvidia-smi` and
  `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`.
- `g6.xlarge` or `g5.xlarge` (24 GB GPU) on-demand; 100 GB gp3 EBS mounted at `/models`.
- Build in CI or on the host: `docker build -t recorder-processor:<git-sha> services/recorder-processor`,
  push to a private ECR repository, run by **digest** with `--gpus all --restart unless-stopped -v /models:/models -p 8443:8443`
  and an env file rendered from SSM at boot into a `0600` tmpfs file.
- Internal Application Load Balancer, HTTPS listener with an ACM certificate for
  `gpu.<private-zone-domain>` (DNS-validated public cert; private hosted zone
  record to the LB), target group HTTP `8443`, health check path used by the
  processor. That name is `RECORDER_GPU_HOSTS`.

### 5.7 Ingestion + workers host

- `t3.small` (2 GiB) Amazon Linux 2023, Elastic IP, DNS `A` record `<ingest-host>`.
- `docker build -t recorder:<git-sha> services/recorder` -> ECR -> run by digest:
  - ingestion: `--network host --restart unless-stopped` (default CMD binds 127.0.0.1:8080)
  - worker: same image, `python production.py`
  - analysis: same image, `python production.py analysis`
- Caddy on the host with `services/recorder/Caddyfile`, `RECORDER_DOMAIN=<ingest-host>`
  (automatic Let's Encrypt TLS). Access logs stay off.
- Env files rendered from SSM at boot (systemd `ExecStartPre`), mode `0600`, tmpfs.

### 5.8 Monitoring, alarms and cost

- CloudWatch agent: CPU, memory, disk; container restarts; GPU utilisation (`nvidia-smi` exporter).
- Alarms: `/readyz` != 200 for 5 min (Route 53 health check or a 1-minute synthetic),
  GPU LB unhealthy hosts > 0, EC2 status check failed, disk > 80 %.
- Supabase-side signals (owner dashboard): `recorder_jobs` pending age, dead count,
  `recording_analysis_jobs` dead count, sessions in **Needs attention**.
- AWS Budget with e-mail alert at 50/80/100 % of the approved monthly amount.

### 5.9 Verification (no customer audio)

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://<ingest-host>/healthz        # 200
curl.exe -s -w "`n%{http_code}`n" https://<ingest-host>/readyz              # 200, or 503 with a fixed code
# The Edge boundary still refuses anonymous callers after S1 is set:
curl.exe -s -w " %{http_code}`n" -X POST https://yimafxhuwgfhvzczqqdd.supabase.co/functions/v1/recorder-ingest -H "content-type: application/json" -d '{\"action\":\"health\",\"payload\":{}}'   # 401
```

Then, with the pilot still **off**, set the four JewelOS secrets and confirm in
the browser (owner's own account, Developer Mode) that Store Intelligence shows
the pilot as disabled and nothing else in JewelOS changed (login, Tasks, FMS,
Forms, CRM).

## 6. Benchmark gate (required before enabling capture)

Run `services/recorder-processor/bench.py` on owner-supplied store recordings kept
outside Git (Hindi, Hinglish, English; quiet and busy floor). Record per language:
word error rate, real-time factor, live lag p50/p95, unknown-speaker share.

**Long-conversation limit.** A final job sends every chunk of the conversation in
one request with an 80 s processor deadline (worker 100 s, lease 120 s). A 30-minute
conversation (1,800 s) therefore needs a real-time factor below about 0.044
including diarization. If the benchmark cannot meet that on the chosen GPU, the
pilot must cap conversation length or the processor needs a bounded/segmented
final pass (code change) **before** activation; do not raise deadlines past the
lease or truncate silently (`services/recorder/README.md`).

## 7. Activation order (JewelOS, Developer Mode owner)

All switches are in **Store Intelligence** (`/sales-recording`) -> **Settings**.

1. Pilot still off. **Sales score settings**: load and approve an SOP version
   (second approver unless Super Admin); confirm the active rubric.
2. Grant `module.sales_recording` and `recording.capture` (explicit, no role
   default) to the 2-3 pilot employees only, in **one** branch; managers of that
   branch keep `recording.review`.
3. **Who can record** -> **Change** (Super Admin; `recorder_configure`): turn recording on for
   those employees and that branch only, keep audio 7 days, live coaching alerts **off**.
4. Run the device matrix (section 8) with synthetic conversations between staff.
5. Turn analysis on in **Sales score settings** (`recording_configure_analysis`) only after transcripts are
   Ready and look right; check **needs review** behaviour on a weak recording.
6. Review after one week with the managers before adding anyone.

## 8. Android pilot (signed, not public)

Follow `docs/MOBILE_RELEASE_GUIDE.md`. Build a **signed pilot APK** and side-load it
on the pilot phones only. Do not run `scripts/release-mobile.ps1` (which publishes
`latest.json` to every installed app) until the matrix below passes on at least
two phone models used in the stores. Base matrix: `apps/mobile/README.md`
"Physical test matrix". Add:

| Test | Pass when |
| --- | --- |
| 15 and 30 minute conversations, screen locked | One session, contiguous chunks, Ready (or a measured, explained Needs attention) |
| Stop from the notification with the app in the background | Final partial chunk ACKed, Saving -> Processing -> Ready |
| Consent withdrawn mid-conversation (Stop + customer asks to delete) | Capture ends; deletion path agreed with the owner before the pilot |
| Phone call during recording | Partial chunk kept, Needs attention, no automatic resume |
| Network off 5 min, then on | Queue drains in order; no duplicate sequence or hash conflict |
| Offline longer than the 5-minute lease | Audio retained; reopening JewelOS renews the ticket for the same session |
| Swipe away / force stop | Encrypted queue recovered on relaunch, same session marked interrupted. Android does not let an app restart itself after **force stop**; recovery happens only when the user reopens JewelOS |
| Hindi, Hinglish, English conversations | Transcript language and text acceptable to the managers; unclear audio flagged |
| Two speakers + background voices | Employee/customer labels, or **unknown** when not clearly separable |
| Playback from evidence | Manager of the branch hears the clip, audit row written; employee and other-branch manager refused |
| Score, evidence, coaching text | Evidence lines exist in the transcript; weak evidence gives no score or needs review |
| CRM customer link + follow-up | Link appears in CRM after sync; follow-up task assigned to the right person |
| Other branch / other tenant | Manager of another branch sees nothing; a non-pilot employee cannot start |
| Battery saver / OEM task killer (each phone model) | Measured and written down per model |

## 9. Go / no-go gates

| Gate | Evidence |
| --- | --- |
| PR #64 reviewed, merged, CI green | Commit SHA |
| Recording RLS active-employment fix (0388 PR) merged and applied | Ledger shows 0388 |
| AWS built from this runbook | Terraform plan/apply log, image digests |
| Secrets set (names only recorded) | Supabase + SSM name lists |
| `/readyz` 200, anonymous Edge 401 | Commands in 5.9 |
| Benchmark meets the long-conversation limit | `bench.py` report |
| Device matrix passed on two models | Filled table |
| Owner approves Bedrock region/data residency and retention | Written approval |

## 10. Kill switch and rollback

- **Stop new capture:** **Settings -> Who can record -> Change**, recording off
  (`recorder_configure(false, ...)`) - immediate; history and other JewelOS sections untouched.
- **Stop analysis:** **Sales score settings**, analysis off (`recording_configure_analysis(false, ...)`).
- **Cut AWS off entirely:** delete `RECORDER_INGEST_SECRET` in Supabase (every
  ingest call returns 401) or stop the containers. Phones keep encrypted audio
  queued; nothing is lost while the queue limit holds.
- **Bad AWS release:** re-run the previous image **digest**.
- Web/app/database need no rollback for any AWS change. Previous known-good web
  deployment and database state: section 1.

## 11. Monthly cost assumptions (estimate - confirm in the AWS Pricing Calculator for ap-south-1)

| Item | Assumption |
| --- | --- |
| GPU `g6.xlarge`/`g5.xlarge` on-demand | Roughly USD 0.9-1.3 per hour -> about USD 650-950 for 24x7, about half if stopped outside store hours |
| Ingestion `t3.small` + 30 GB gp3 + Elastic IP | About USD 25-35 |
| Internal ALB | About USD 20-25 + LCU |
| NAT gateway (only while downloading models) | About USD 35 per month if left running - remove after first start |
| S3 + KMS | 16 kHz PCM is about 115 MB per recorded hour; 7-day retention keeps this to a few dollars; KMS key USD 1 + requests |
| CloudWatch | About USD 5-15 |
| Bedrock Claude | Per-token price for the chosen model/region; budget about 15k input + 2k output tokens per 30-minute conversation and check the AWS price page |
