# Store Intelligence activation runbook (end to end)

Owner-run procedure to turn Store Intelligence recording on for **one branch and a
few employees**, from an empty AWS account to a working pilot on real phones. The
JewelOS code, database and Edge Functions on `main` are already live (section 1).
This runbook adds what is missing: decisions and accounts, the GPU processor code,
AWS processing, recorder secrets, a benchmark, a signed pilot APK on real phones,
and the pilot switches.

Read first: `AGENTS.md`, `PRODUCTION_SWITCH_PLAYBOOK.md`, `docs/RECORDING_PILOT.md`,
`services/recorder/README.md`, `docs/MOBILE_RELEASE_GUIDE.md`.

**Recording stays OFF until every gate in section 12 is green.** Nothing here is
a reason to insert placeholder URLs, example secrets or test data into production.

## 0. The whole journey at a glance

| Phase | What | Who | Typical time |
| --- | --- | --- | --- |
| A | Decisions, accounts, legal notice, domain, quotas (section 3) | Owner | 1-3 days (AWS quota and Bedrock approval waits) |
| B | Code: merge PR #64 (GPU processor + Bedrock analyzer); Android recorder fixes (section 10.4) | Engineering, owner approves | 1-2 days |
| C | AWS build: state, storage, roles, secrets, network, GPU host, ingestion host, monitoring (section 6) | Owner or engineer with AWS admin, owner present | 1 day |
| D | Connect JewelOS to AWS: four Supabase secrets, pilot still off (section 6.10) | Owner | 30 min |
| E | Benchmark on real store audio (section 7) | Engineer + owner's sample recordings | Half a day |
| F | Signed pilot APK on 2-3 pilot phones, phone set-up (sections 10-11) | Engineer + store manager | Half a day |
| G | Switch on for one branch, run the device matrix with staff-only test conversations (sections 8, 11) | Owner | 2-3 days |
| H | First week with managers, then decide to widen (section 8 step 6) | Owner + managers | 1 week |

## 1. State on 2026-11-09 (verified, read-only unless stated)

| Item | State |
| --- | --- |
| JewelOS DB `yimafxhuwgfhvzczqqdd` | Ledger = `main` through `0396` (0396 = recording reads require active employment, applied 2026-11-09) |
| CRM DB `fsydcsyqnddacjfoutfe` (`walk-in_crm`) | Ledger = `main` through `20261106000200` |
| JewelOS functions `recorder-session` (JWT on), `recorder-ingest` (JWT off + `x-recorder-secret`), `crm-customer-sync` | Deployed source byte-identical to `main` (2026-11-06) |
| `RECORDER_*` Edge secrets | **None set** -> `recorder-ingest` answers 401 to everything, `recorder-session` cannot issue URLs |
| `recorder_config` | No rows -> capture, analysis and coaching all off; no devices or sessions |
| AWS | Nothing provisioned; no AWS access configured on the release machine |
| GPU processor + Bedrock analyzer | **Only in open PR #64** (`services/recorder-processor`), not on `main` |
| Android | Published app is **1.0.17 (versionCode 18), which has no native recorder**. The native recorder is on `main` but in no released APK; no physical-device run yet (section 10) |

## 2. How the pieces talk

```text
Phone (JewelOS web inside the Android app; native recorder service does the capture)
  1. Web page -> recorder-session (JewelOS login)  -> SQL recorder_issue_ticket -> 60-second single-use ticket + upload origin
  2. Web page hands the ticket to the native recorder service over the app bridge
  3. Native service -> AWS ingestion POST /v1/connect (ticket) -> ingestion redeems it via recorder-ingest (x-recorder-secret)
                    <- 5-minute ingest token bound to one session/device/branch/employee
  4. Native service -> POST /v1/chunks (2-second PCM chunks) -> S3 (SSE-KMS) + receipt in Supabase -> ACK -> phone deletes the chunk
  5. Stop -> POST /v1/commit -> session Processing
AWS worker      : claim_job via recorder-ingest -> presigned S3 GETs -> GPU processor -> segments / final transcript
AWS analysis    : analysis_claim -> Claude (Bedrock) -> analysis_submit (server computes the score)
Playback        : recorder-session 'playback' -> single-use audited ticket -> AWS POST /v1/playback -> WAV
CRM             : unchanged two-project outbox (crm-customer-sync -> CRM sync-receive); no AWS involvement
```

AWS never holds a Supabase service-role key or a user JWT. Supabase never holds
an AWS key. The only shared secrets are S1 and S2 (section 5).

## 3. Phase A - decisions and accounts (owner)

Do these first; several involve waiting for AWS.

1. **Legal and consent.** Customer conversations are personal data under India's
   Digital Personal Data Protection Act, 2023. Before any real customer is
   recorded, get the store notice, the verbal consent script the employee will
   use, the 7-day audio retention, and the deletion-on-request process approved
   by the owner (and counsel if available). Employees sign an acknowledgement
   that they are recorded during work. Write the approval down (gate in section 12).
2. **AWS account.** At <https://aws.amazon.com> create an account in the
   company's name with a company e-mail and card. Then, signed in as root:
   - turn on MFA for the root user, and never use root again after this list;
   - **Billing -> Budgets**: create a monthly cost budget (for example USD 1,200)
     with e-mail alerts at 50/80/100 %;
   - **IAM Identity Center** (region `ap-south-1`): enable it, create a user for
     the operator with MFA, a permission set `AdministratorAccess`, and assign it
     to the account. All later steps use this user, not root.
3. **Region.** `ap-south-1` (Mumbai), the same region as both Supabase projects.
4. **GPU quota.** **Service Quotas -> Amazon EC2 -> "Running On-Demand G and VT
   instances"**: request 8 vCPUs in `ap-south-1`. New accounts start at 0; approval
   can take 1-2 days. Nothing GPU-related can start until this is granted.
5. **Claude on Bedrock.** **Amazon Bedrock -> Model access** (in `ap-south-1`):
   request access to the Anthropic Claude model chosen in PR #64 (fill the
   Anthropic use-case form). Note whether the model is served in-region or only
   through an `apac.` cross-region inference profile; the owner approves the
   resulting data-processing regions (gate in section 12).
6. **Domain name for the ingestion server.** Phones upload over HTTPS, which needs
   a real DNS name you control, for example `rec.<your-domain>`. If the company has
   no domain, buy one (Route 53 or any registrar). You need to be able to add an
   `A` record. For the GPU load balancer you also need a certificate name such as
   `gpu.<your-domain>` (DNS-validated in ACM; the record stays private).
7. **Hugging Face.** Create an account at <https://huggingface.co>, accept the
   terms of the pyannote speaker-diarization models named in
   `services/recorder-processor/README.md` (PR #64), and create a **read** token.
   It is a secret (`PROCESSOR_HF_TOKEN`).
8. **Password manager entry** named "JewelOS recorder" to hold S1, S2 and the
   Hugging Face token. Nobody pastes them into chat, e-mail, Git or WhatsApp.
9. **Pilot scope.** One branch, 2-3 employees, their store manager, and the phone
   models they actually use (at least two different models, section 11).
10. **Store Wi-Fi or mobile data** on the pilot phones that reaches the internet
    during store hours (upload is about 115 MB per recorded hour).

## 4. Phase B - code that must land first

| Item | Status | Action |
| --- | --- | --- |
| Recording RLS fix (0396) | Merged and applied 2026-11-09 | None |
| PR #64 GPU processor + Bedrock analyzer | Open, CI green on its branch | Review, update with `main`, merge; it adds no migration. Without it there is no transcription service to deploy |
| Android recorder hardening (section 10.4) | Recommended before the pilot APK | Engineering change + new pilot build |

## 5. Variables and secrets (exact names)

Generate each shared secret once (`openssl rand -hex 32`, or a password manager's
64-character generator), store it in the password manager and in AWS SSM, and
paste it into the Supabase dashboard. Never on a command line, in Git, Terraform,
Vercel, the APK, logs or chat.

- **S1** = `RECORDER_INGEST_SECRET` (Supabase) = `RECORDER_BACKEND_SECRET` (AWS ingestion/workers)
- **S2** = `RECORDER_GPU_TOKEN` (AWS worker) = `PROCESSOR_TOKEN` (GPU processor)

### JewelOS Supabase (`yimafxhuwgfhvzczqqdd`) Edge Function secrets

| Name | Value | Contract |
| --- | --- | --- |
| `RECORDER_UPLOAD_URL` | `https://<ingest-host>` (origin only, no path) | `recorder-session` refuses anything but a bare `https://` origin |
| `RECORDER_STREAM_URL` | `wss://<ingest-host>` | bare `wss://` origin |
| `RECORDER_ALLOWED_ORIGINS` | `https://mkjewels-os.vercel.app` (comma list; add a custom domain only if one serves JewelOS) | Browser `Origin` exact match, else 403 |
| `RECORDER_INGEST_SECRET` | **S1** | Compared in constant time with `x-recorder-secret`; empty = everything 401 |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are platform-provided.

### CRM Supabase (`fsydcsyqnddacjfoutfe`)

**Nothing new.** The recording -> CRM link uses the existing `CRM_SYNC_*` outbox
secrets. Do not copy recorder secrets to CRM.

### AWS ingestion + transcription worker + analysis worker (same image)

| Name | Value |
| --- | --- |
| `RECORDER_EDGE_URL` | `https://yimafxhuwgfhvzczqqdd.supabase.co/functions/v1/recorder-ingest` |
| `RECORDER_BACKEND_SECRET` | **S1** |
| `RECORDER_BUCKET` | Terraform output `bucket` |
| `RECORDER_KMS_KEY_ARN` | Terraform output `kms_key_arn` |
| `RECORDER_ORIGINS` | `https://mkjewels-os.vercel.app` (same list as `RECORDER_ALLOWED_ORIGINS`) |
| `RECORDER_GPU_URL` | `https://gpu.<your-domain>/v1/transcribe` (worker) |
| `RECORDER_GPU_TOKEN` | **S2** (worker) |
| `RECORDER_GPU_HOSTS` | `gpu.<your-domain>` exact (worker) |
| `RECORDER_FINALIZE_TRANSCRIPTS` | `true` once the benchmark passes (worker) |
| `RECORDER_COACHING_ENABLED` | leave unset (live coaching off for the pilot) |
| `RECORDER_ANALYZER_KIND` | `bedrock` (PR #64) |
| `RECORDER_ANALYZER_REGION` | Region (or the inference profile's region) serving the approved Claude model |
| `RECORDER_ANALYZER_MODEL` | The Bedrock model or inference-profile id enabled in phase A step 5 |
| `RECORDER_ANALYZER_EFFORT` | `high` (default) |
| `RECORDER_ANALYZER_URL`, `_TOKEN`, `_HOSTS`, `_PROVIDER`, `_MODEL` | Only for a private HTTPS analyzer gateway instead of Bedrock |
| `RECORDER_ANALYZER_FALLBACK_*` | Optional second analyzer; its use forces manager review |
| `RECORDER_ANALYSIS_JOB_VERSIONS` | `mk-sales-v1` |
| `RECORDER_DOMAIN` | Caddy site name = `<ingest-host>` |

### AWS GPU processor (PR #64)

| Name | Value |
| --- | --- |
| `PROCESSOR_TOKEN` | **S2** |
| `PROCESSOR_AUDIO_HOSTS` | Exact S3 host in the worker's presigned URLs: `<bucket>.s3.ap-south-1.amazonaws.com` |
| `PROCESSOR_ENGINE` / `PROCESSOR_WHISPER_MODEL` | `whisper` / `large-v3` (decide from the benchmark) |
| `PROCESSOR_LANGUAGES` | `hi,en` |
| `PROCESSOR_DIARIZATION` | `true` |
| `PROCESSOR_HF_TOKEN` | Hugging Face read token (secret) |
| `PROCESSOR_TRANSLATE`, `PROCESSOR_COMPUTE_TYPE`, `PROCESSOR_DEVICE` | optional; defaults `false`, `float16`, `cuda` |

Rotation: S1 needs Supabase and AWS changed together (brief 401 window; phones keep
audio queued); S2 needs worker and GPU changed together. Neither touches phones or the web build.

## 6. Phase C - AWS build, step by step (`ap-south-1`)

Operator machine: install AWS CLI v2, Terraform >= 1.9, Docker Desktop and
PowerShell 7, then record `aws --version`, `terraform version`, `docker version`.
Sign in with the Identity Center user: `aws configure sso --profile mkj-rec`, then
`aws sso login --profile mkj-rec`.

### 6.1 Preflight (read-only)

```powershell
$env:AWS_PROFILE='mkj-rec'; $r='ap-south-1'
aws sts get-caller-identity
aws ec2 describe-instance-type-offerings --region $r --location-type availability-zone `
  --filters Name=instance-type,Values=g6.xlarge,g5.xlarge,g4dn.xlarge --query 'InstanceTypeOfferings[].[InstanceType,Location]' --output table
aws service-quotas get-service-quota --region $r --service-code ec2 --quota-code L-DB2E81BA   # must be >= 4
aws bedrock list-foundation-models --region $r --by-provider anthropic --query 'modelSummaries[].modelId'
aws bedrock list-inference-profiles --region $r --query 'inferenceProfileSummaries[].inferenceProfileId'
```

Stop if no GPU type is offered, the quota is below 4, or the approved Claude model is not listed.

### 6.2 Remote Terraform state (once)

```powershell
$acct = aws sts get-caller-identity --query Account --output text
aws s3api create-bucket --bucket "mkj-tfstate-$acct" --region $r --create-bucket-configuration LocationConstraint=$r
aws s3api put-bucket-versioning --bucket "mkj-tfstate-$acct" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "mkj-tfstate-$acct" --server-side-encryption-configuration '{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":{\"SSEAlgorithm\":\"aws:kms\"}}]}'
aws s3api put-public-access-block --bucket "mkj-tfstate-$acct" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Create `services/recorder/infra/backend_override.tf` (ignored by Git):

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

### 6.3 Roles, then storage

`ec2-trust.json` (keep outside the repository):

```json
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}
```

```powershell
foreach ($n in 'jewelos-recorder','jewelos-recorder-gpu') {
  aws iam create-role --role-name $n --assume-role-policy-document file://ec2-trust.json
  aws iam create-instance-profile --instance-profile-name $n
  aws iam add-role-to-instance-profile --instance-profile-name $n --role-name $n
  aws iam attach-role-policy --role-name $n --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  aws iam attach-role-policy --role-name $n --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
}

cd services/recorder/infra
terraform init
terraform fmt -check; terraform validate
terraform plan -var bucket_name=mkj-recorder-audio-$acct -var recorder_role_arn=arn:aws:iam::${acct}:role/jewelos-recorder -var retention_days=7 -out storage.tfplan
# Review: 1 KMS key, 1 bucket + its settings/policy, 1 IAM policy + 1 attachment. Nothing destroyed.
terraform apply storage.tfplan
terraform output
```

Inline policies (least privilege):

- `jewelos-recorder`: `ssm:GetParametersByPath` and `ssm:GetParameters` on
  `arn:aws:ssm:ap-south-1:<account>:parameter/jewelos/recorder/app/*`; `kms:Decrypt`
  on the AWS-managed SSM key; `bedrock:InvokeModel` and
  `bedrock:InvokeModelWithResponseStream` on the approved model / inference-profile ARNs only.
- `jewelos-recorder-gpu`: SSM read on `.../parameter/jewelos/recorder/gpu/*` only;
  **no** S3 permission (it reads only presigned URLs).

### 6.4 Parameters and secrets

Each parameter is named after its environment variable, so the host can render the
env file mechanically. Secrets are `SecureString`; everything else `String`.

```powershell
# PowerShell 7. Secrets are typed at a hidden prompt, never inline.
function Put-Secret($path) { $v = Read-Host -AsSecureString "Value for $path" | ConvertFrom-SecureString -AsPlainText
  aws ssm put-parameter --name $path --type SecureString --value $v --overwrite | Out-Null; Remove-Variable v }
function Put-Plain($path, $value) { aws ssm put-parameter --name $path --type String --value $value --overwrite | Out-Null }

Put-Secret /jewelos/recorder/app/RECORDER_BACKEND_SECRET        # S1
Put-Secret /jewelos/recorder/app/RECORDER_GPU_TOKEN             # S2
Put-Plain  /jewelos/recorder/app/RECORDER_EDGE_URL 'https://yimafxhuwgfhvzczqqdd.supabase.co/functions/v1/recorder-ingest'
Put-Plain  /jewelos/recorder/app/RECORDER_BUCKET '<terraform output bucket>'
Put-Plain  /jewelos/recorder/app/RECORDER_KMS_KEY_ARN '<terraform output kms_key_arn>'
Put-Plain  /jewelos/recorder/app/RECORDER_ORIGINS 'https://mkjewels-os.vercel.app'
Put-Plain  /jewelos/recorder/app/RECORDER_DOMAIN 'rec.<your-domain>'
Put-Plain  /jewelos/recorder/app/RECORDER_GPU_URL 'https://gpu.<your-domain>/v1/transcribe'
Put-Plain  /jewelos/recorder/app/RECORDER_GPU_HOSTS 'gpu.<your-domain>'
Put-Plain  /jewelos/recorder/app/RECORDER_ANALYZER_KIND 'bedrock'
Put-Plain  /jewelos/recorder/app/RECORDER_ANALYZER_REGION '<approved region>'
Put-Plain  /jewelos/recorder/app/RECORDER_ANALYZER_MODEL '<approved model or profile id>'
Put-Plain  /jewelos/recorder/app/RECORDER_ANALYSIS_JOB_VERSIONS 'mk-sales-v1'

Put-Secret /jewelos/recorder/gpu/PROCESSOR_TOKEN                # S2 again
Put-Secret /jewelos/recorder/gpu/PROCESSOR_HF_TOKEN
Put-Plain  /jewelos/recorder/gpu/PROCESSOR_AUDIO_HOSTS '<bucket>.s3.ap-south-1.amazonaws.com'
Put-Plain  /jewelos/recorder/gpu/PROCESSOR_ENGINE 'whisper'
Put-Plain  /jewelos/recorder/gpu/PROCESSOR_WHISPER_MODEL 'large-v3'
Put-Plain  /jewelos/recorder/gpu/PROCESSOR_LANGUAGES 'hi,en'
Put-Plain  /jewelos/recorder/gpu/PROCESSOR_DIARIZATION 'true'
```

`RECORDER_FINALIZE_TRANSCRIPTS=true` is added after the benchmark (section 7).

### 6.5 Network

Console **VPC -> Create VPC -> "VPC and more"**: 1 availability zone where the
GPU type is offered, 1 public + 1 private subnet, NAT gateway "In 1 AZ" (temporary),
S3 gateway endpoint "Yes". Then security groups:

| Group | Inbound | Used by |
| --- | --- | --- |
| `sg-ingest` | 443 and 80 from `0.0.0.0/0` (80 only for the Let's Encrypt challenge) | Ingestion host |
| `sg-gpu-lb` | 443 from `sg-ingest` only | Internal load balancer |
| `sg-gpu` | 8443 from `sg-gpu-lb` only | GPU host |

No SSH anywhere: use **Systems Manager -> Session Manager** to get a shell.
After the GPU host has downloaded its models once (6.6), delete the NAT gateway
and its Elastic IP (about USD 35 a month saved).

### 6.6 Container images (operator machine)

```powershell
aws ecr create-repository --repository-name jewelos/recorder --image-scanning-configuration scanOnPush=true --image-tag-mutability IMMUTABLE
aws ecr create-repository --repository-name jewelos/recorder-processor --image-scanning-configuration scanOnPush=true --image-tag-mutability IMMUTABLE
$reg = "$acct.dkr.ecr.ap-south-1.amazonaws.com"
aws ecr get-login-password | docker login --username AWS --password-stdin $reg
$sha = git rev-parse --short HEAD     # a clean checkout of main after PR #64 is merged
docker build -t "$reg/jewelos/recorder:$sha" services/recorder;           docker push "$reg/jewelos/recorder:$sha"
docker build -t "$reg/jewelos/recorder-processor:$sha" services/recorder-processor; docker push "$reg/jewelos/recorder-processor:$sha"
aws ecr describe-images --repository-name jewelos/recorder --image-ids imageTag=$sha --query 'imageDetails[0].imageDigest'
aws ecr describe-images --repository-name jewelos/recorder-processor --image-ids imageTag=$sha --query 'imageDetails[0].imageDigest'
```

Record both digests (`sha256:...`). Hosts run images by digest; rollback = previous digest.

### 6.7 GPU processor host

1. **EC2 -> Launch instance**: AMI "Deep Learning Base OSS Nvidia Driver GPU AMI
   (Ubuntu 22.04)", type `g6.xlarge` (or `g5.xlarge`), private subnet, `sg-gpu`,
   instance profile `jewelos-recorder-gpu`, root 60 GB gp3 plus a second 100 GB
   gp3 volume, IMDSv2 required.
2. Session Manager shell:

```bash
nvidia-smi                                                      # driver works
sudo mkfs -t xfs /dev/nvme1n1 && sudo mkdir -p /models && echo '/dev/nvme1n1 /models xfs defaults,nofail 0 2' | sudo tee -a /etc/fstab && sudo mount -a
sudo docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi   # GPU visible in containers
sudo apt-get install -y awscli || sudo snap install aws-cli --classic
```

3. `/usr/local/bin/render-env` (both hosts use the same script; argument = SSM path):

```bash
#!/bin/sh
set -eu
umask 077; mkdir -p /run/recorder
aws ssm get-parameters-by-path --region ap-south-1 --path "$1" --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text | awk -F'\t' '{n=$1; sub(".*/","",n); print n"="$2}' > /run/recorder/env.tmp
mv /run/recorder/env.tmp /run/recorder/env
```

`/run` is a tmpfs: the env file never reaches disk and disappears on reboot.

4. `/etc/systemd/system/recorder-processor.service`:

```ini
[Unit]
After=docker.service network-online.target
Requires=docker.service
[Service]
ExecStartPre=/usr/local/bin/render-env /jewelos/recorder/gpu/
ExecStartPre=/bin/sh -c 'aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.ap-south-1.amazonaws.com'
ExecStartPre=-/usr/bin/docker rm -f recorder-processor
ExecStart=/usr/bin/docker run --rm --name recorder-processor --gpus all -p 8443:8443 -v /models:/models --env-file /run/recorder/env <account>.dkr.ecr.ap-south-1.amazonaws.com/jewelos/recorder-processor@sha256:<digest>
ExecStop=/usr/bin/docker stop recorder-processor
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
```

```bash
sudo chmod 755 /usr/local/bin/render-env
sudo systemctl daemon-reload && sudo systemctl enable --now recorder-processor
curl -s http://127.0.0.1:8443/healthz      # 200 once the models are loaded (first start downloads them)
```

5. **Certificate and load balancer.** **ACM -> Request public certificate** for
   `gpu.<your-domain>`, DNS validation (add the CNAME it shows at your DNS provider).
   **EC2 -> Target groups**: HTTP, port 8443, health check `/healthz`, register the
   GPU instance. **Load balancers -> Application, Internal**, private subnet(s),
   `sg-gpu-lb`, HTTPS:443 listener with that certificate forwarding to the target group.
   **Route 53 -> Hosted zones -> Create private hosted zone** `<your-domain>` attached
   to the VPC, alias record `gpu.<your-domain>` -> the internal load balancer.

### 6.8 Ingestion + workers host

1. **EC2 -> Launch instance**: Amazon Linux 2023, `t3.small`, public subnet,
   `sg-ingest`, instance profile `jewelos-recorder`, 30 GB gp3, IMDSv2 required
   (hop limit 2). Allocate an **Elastic IP** and associate it. At your DNS provider
   add `A rec.<your-domain>` -> that Elastic IP.
2. Session Manager shell:

```bash
sudo dnf install -y docker && sudo systemctl enable --now docker
# copy render-env from 6.7 step 3 to /usr/local/bin/render-env, chmod 755
sudo mkdir -p /etc/caddy
```

3. `/etc/caddy/Caddyfile` = the content of `services/recorder/Caddyfile` from `main`.
4. Four units, all `Restart=always`, each with
   `ExecStartPre=/usr/local/bin/render-env /jewelos/recorder/app/` and the ECR login line from 6.7:

| Unit | `ExecStart` |
| --- | --- |
| `recorder-ingest` | `docker run --rm --name recorder-ingest --network host --env-file /run/recorder/env <registry>/jewelos/recorder@sha256:<digest>` |
| `recorder-worker` | `... --name recorder-worker --network host --env-file /run/recorder/env <image@digest> python production.py` |
| `recorder-analysis` | `... --name recorder-analysis --network host --env-file /run/recorder/env <image@digest> python production.py analysis` |
| `caddy` | `docker run --rm --name caddy --network host -e RECORDER_DOMAIN=rec.<your-domain> -v /etc/caddy/Caddyfile:/etc/caddy/Caddyfile:ro -v caddy_data:/data caddy:2.8.4` |

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now recorder-ingest recorder-worker recorder-analysis caddy
sudo systemctl --no-pager status recorder-ingest recorder-worker recorder-analysis caddy
```

The application binds only `127.0.0.1:8080`; Caddy is the only public listener and
gets the TLS certificate automatically. Access logs stay off.

### 6.9 Monitoring, alarms and cost

- CloudWatch agent on both hosts (CPU, memory, disk) and the GPU's NVIDIA metrics.
- **Route 53 health check** on `https://rec.<your-domain>/readyz` with an alarm to the owner's e-mail.
- Alarms: GPU target group unhealthy hosts > 0; EC2 status check failed; disk > 80 %.
- Supabase-side signals (owner): `recorder_jobs` pending age and dead count,
  `recording_analysis_jobs` dead count, sessions in **Needs attention**.
- Optional cost saver: **EventBridge Scheduler** stops the GPU instance after store
  hours and starts it 30 minutes before opening (jobs queue in Supabase meanwhile).

### 6.10 Phase D - connect JewelOS (pilot still off)

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://rec.<your-domain>/healthz     # 200
curl.exe -s -w "`n%{http_code}`n" https://rec.<your-domain>/readyz           # 200 (503 + fixed code until S1 is set below)
```

Supabase dashboard -> project `yimafxhuwgfhvzczqqdd` (check the ref) -> **Edge
Functions -> Secrets** -> add the four names from section 5 (S1 pasted from the
password manager). Then:

```powershell
curl.exe -s -w "`n%{http_code}`n" https://rec.<your-domain>/readyz           # 200
# Anonymous callers are still refused:
curl.exe -s -w " %{http_code}`n" -X POST https://yimafxhuwgfhvzczqqdd.supabase.co/functions/v1/recorder-ingest -H "content-type: application/json" -d '{\"action\":\"health\",\"payload\":{}}'   # 401
supabase.cmd secrets list --project-ref yimafxhuwgfhvzczqqdd   # names only; four RECORDER_* present
```

Sign in to JewelOS as the owner and confirm Store Intelligence still shows the
pilot as off and nothing else changed (login, Tasks, FMS, Forms, CRM).

## 7. Phase E - benchmark gate (required before enabling capture)

Run `services/recorder-processor/bench.py` on the GPU host against 5-10 owner-supplied
store recordings kept outside Git (Hindi, Hinglish, English; quiet and busy floor;
10, 20 and 30+ minutes). Record per language: word error rate, real-time factor,
live lag p50/p95, unknown-speaker share. Delete the samples after.

**Long-conversation limit.** A final job sends every chunk of the conversation in
one request with an 80 s processor deadline (worker 100 s, lease 120 s). A 30-minute
conversation (1,800 s) therefore needs a real-time factor below about 0.044
including diarization. If the benchmark cannot meet that, the pilot must cap
conversation length or the processor needs a bounded/segmented final pass (code
change) **before** activation; do not raise deadlines past the lease or truncate
silently (`services/recorder/README.md`). When it passes, set
`RECORDER_FINALIZE_TRANSCRIPTS=true` (6.4) and restart `recorder-worker`.

## 8. Phase G - activation order (JewelOS, owner)

All switches are in **Store Intelligence** (`/sales-recording`) -> **Settings**.

1. Pilot still off. **Sales score settings**: load and approve an SOP version
   (second approver unless Super Admin); confirm the active rubric.
2. Grant `module.sales_recording` and `recording.capture` (explicit, no role
   default) to the 2-3 pilot employees only, in **one** branch; managers of that
   branch keep `recording.review`. Pilot employees must have working status
   **Active** (migration 0396: anyone not Active cannot read or record).
3. **Who can record** -> **Change** (Super Admin): turn recording on for those
   employees and that branch only, keep audio 7 days, live coaching alerts **off**.
4. Run the device matrix (section 11) with staff-only test conversations.
5. Turn analysis on in **Sales score settings** only after transcripts are Ready
   and look right; check **needs review** behaviour on a weak recording.
6. Review after one week with the managers before adding anyone.

## 9. Daily use (what the pilot employee does)

1. Open the JewelOS app (pilot build), sign in, go to **Store Intelligence**.
2. Greet the customer, give the consent line, tap **Start**. A "JewelOS recording"
   notification appears; the phone can now be locked and pocketed or placed on the counter.
3. When the conversation ends tap **Stop** (in the app or **Stop and save** in the
   notification). The session moves Saving -> Processing -> Ready.
4. If the banner says **Recording needs attention** (phone call, another app took
   the microphone, storage full), open the app and tap **Resume** or **Stop**.
5. Do not force-stop the app, log out, or install app updates while recording.

## 10. Android: the WebView app and the screen-off problem

### 10.1 Why recording stopped when the screen turned off

The Android app is a shell that shows the web app in a WebView. In the published
app (**1.0.17**) the recording runs **inside the web page** (browser microphone
API). When the screen turns off or the app goes to the background, Android pauses
the WebView and its page, so the microphone stops. No web-only fix can solve this;
a background page is not allowed to keep the microphone.

### 10.2 What `main` now has (not yet in any released APK)

A **native recorder service** (`apps/mobile/src/features/webShell/native/RecorderService.kt`)
that the web page controls over the app bridge. Once started it does not depend on
the WebView:

- Android **foreground service of type microphone** with a permanent notification
  and a **Stop and save** button, so Android allows the microphone with the screen off;
- a **partial wake lock** (CPU stays on, screen may sleep), maximum 4 hours;
- audio in 2-second chunks written to an **on-phone queue** before upload, so
  nothing is lost if the network or the app disappears;
- uploads directly to AWS from native code; `stopWithTask=false` keeps it running
  if the app is swiped away;
- the web page detects the native recorder (`nativeRecorderAvailable()`); in the
  old 1.0.17 app it falls back to in-page recording and shows "This app version
  can record only while this page stays open."

### 10.3 Remaining risks and what handles them

| Risk | Effect | Handling |
| --- | --- | --- |
| **Upload authorization depends on the web page.** The ingest token lasts 5 minutes; the page fetches a fresh 60-second ticket every 45 s. With the screen off Android may pause or throttle the page | Capture **continues**, but uploads pause until the phone is unlocked. The on-phone queue holds 64 MB, about **35 minutes** of audio; beyond that capture stops with "needs attention (queue full)" | Fix 10.4 (a) and (b) before the pilot; until then keep conversations under ~30 minutes or unlock the phone once mid-conversation |
| Old app 1.0.17 still installed | In-page recording, stops with the screen off | Fix 10.4 (c); pilot phones get only the pilot build |
| OEM battery killers (Xiaomi/Redmi/POCO, Oppo/Realme/OnePlus, Vivo/iQOO, some Samsung) | Service killed in the background | Phone set-up 10.5; measured per model in section 11 |
| Notification permission refused (Android 13+) | Recorder refuses to start | The app asks; employee must tap **Allow** |
| Phone call, WhatsApp voice note, camera video | Microphone taken; capture stops to **Needs attention**, partial audio kept | Employee taps **Resume** afterwards (same session) |
| Force stop, phone restart, app update during recording | Capture ends; queue kept; marked interrupted | Reopen JewelOS; it uploads the rest. Do not update the app during store hours |
| Log out while recording | Capture pauses | Training |
| Phone storage nearly full | Capture stops (storage failed) | Keep >= 1 GB free on pilot phones |
| Phone in a pocket | Muffled audio, worse transcripts | Phone face-up on the counter or a clip-on lavalier mic; compare in the benchmark |

### 10.4 Engineering changes recommended before the pilot APK

a. **Upload keeps going with the screen off.** Make the ingest token slide: each
   accepted chunk extends it (absolute cap = session limit, 4 h), and the native
   service reads the new expiry from the ACK. Then the page is needed only to
   start, resume and recover, not to keep uploads alive.
   (`services/recorder/recorder.py` `authorize`/chunk ACK; `RecorderService.kt` `drain`.)
b. **Raise the on-phone queue** from 64 MB to 256 MB (about 2.3 hours) so a long
   offline period cannot stop capture (`RecorderService.kt` `QUEUE_LIMIT`).
c. **Block in-page recording inside an old app.** In `RecordFlow.tsx`, when
   `inAppWithoutNative` is true, replace **Start** with "Update the JewelOS app to
   record" instead of falling back to the page recorder that stops with the screen off.

All three ship together with the pilot APK and are tested by the matrix in section 11.

### 10.5 Pilot phone set-up (every pilot phone, before day one)

1. Uninstall nothing; install the **signed pilot APK** over the existing app
   (same signing key, so login and data stay). Confirm the version in the app.
2. **Settings -> Apps -> JewelOS -> Permissions**: Microphone **Allow only while
   using the app**, Notifications **Allow**.
3. **Settings -> Apps -> JewelOS -> Battery**: **Unrestricted** (or "Don't optimise").
4. Manufacturer extras:
   - Xiaomi / Redmi / POCO: **Autostart** on; Battery saver **No restrictions**; lock JewelOS in Recents (long-press -> lock).
   - Oppo / Realme / OnePlus: **Allow background activity**, **Allow auto launch**; lock in Recents.
   - Vivo / iQOO: **Allow high background power consumption**; Autostart on.
   - Samsung: **Battery -> Background usage limits** -> remove JewelOS from Sleeping / Deep sleeping apps; add to **Never sleeping apps**.
5. Turn off **Battery saver / Ultra power saving** during store hours.
6. Keep >= 1 GB free storage; connect store Wi-Fi.
7. Do a 2-minute test recording with the screen locked before the first customer.

### 10.6 Building the pilot APK (not public)

Follow `docs/MOBILE_RELEASE_GUIDE.md` for the signing key and toolchain, build a
signed release APK with the next `versionCode`, and side-load it on the pilot phones
only (USB `adb install -r` or a private link). **Do not** run
`scripts/release-mobile.ps1` and do not touch `latest.json` until section 11 passes
on two phone models; that script pushes the update to every installed app.

## 11. Android pilot test matrix (physical phones)

Base matrix: `apps/mobile/README.md` "Physical test matrix". Add:

| Test | Pass when |
| --- | --- |
| 15, 30 and **45 minute** conversations, screen locked the whole time | One session, contiguous chunks, uploads continue with the screen off (queue in the app stays small), Ready |
| Stop from the notification with the app in the background | Final partial chunk ACKed, Saving -> Processing -> Ready |
| Consent withdrawn mid-conversation (Stop + customer asks to delete) | Capture ends; deletion path agreed with the owner before the pilot |
| Phone call during recording | Partial chunk kept, Needs attention, no automatic resume; Resume continues the same session |
| Network off 10 min, then on | Queue drains in order; no duplicate sequence or hash conflict |
| Offline longer than the 5-minute token | Audio retained; uploads resume (after 10.4 a: by themselves; before it: when JewelOS is opened) |
| Swipe away the app while recording | Recording continues; notification still shown |
| Force stop / restart the phone | Encrypted queue recovered on relaunch, same session marked interrupted |
| Battery saver on, OEM task killer (each phone model) | Measured and written down per model |
| Old 1.0.17 app on a non-pilot phone | Cannot start recording (after 10.4 c) |
| Hindi, Hinglish, English conversations | Transcript acceptable to the managers; unclear audio flagged |
| Two speakers + background voices | Employee/customer labels, or **unknown** when not separable |
| Playback from evidence | Branch manager hears the clip, audit row written; employee and other-branch manager refused |
| Score, evidence, coaching text | Evidence lines exist in the transcript; weak evidence gives no score or needs review |
| CRM customer link + follow-up | Link appears in CRM after sync; follow-up task to the right person |
| Other branch / other tenant / employee set On leave | Sees nothing; cannot start |
| Battery drain over a 4-hour shift with 4-6 conversations | Recorded per model; acceptable to the store |

## 12. Go / no-go gates

| Gate | Evidence |
| --- | --- |
| Recording RLS fix 0396 applied | Ledger shows 0396 (done 2026-11-09) |
| PR #64 reviewed, merged, CI green | Commit SHA |
| Android hardening 10.4 merged; pilot APK built from it | Commit SHA, APK versionCode |
| Consent notice, retention and deletion process approved | Written owner approval |
| Bedrock model/region and data residency approved | Written owner approval |
| AWS built from this runbook | Terraform plan/apply log, image digests |
| Secrets set (names only recorded) | Supabase + SSM name lists |
| `/readyz` 200, anonymous Edge 401 | Commands in 6.10 |
| Benchmark meets the long-conversation limit | `bench.py` report |
| Device matrix passed on two models | Filled table |

## 13. Kill switch and rollback

- **Stop new capture:** **Settings -> Who can record -> Change**, recording off -
  immediate; history and other JewelOS sections untouched.
- **Stop analysis:** **Sales score settings**, analysis off.
- **Cut AWS off entirely:** delete `RECORDER_INGEST_SECRET` in Supabase (every
  ingest call returns 401) or stop the units. Phones keep audio queued within the queue limit.
- **Bad AWS release:** change the unit to the previous image **digest**, `systemctl restart`.
- **Bad pilot APK:** reinstall the previous signed APK on the pilot phones; the public `latest.json` was never changed.
- Web/app/database need no rollback for any AWS change.

## 14. Monthly cost assumptions (estimate - confirm in the AWS Pricing Calculator for ap-south-1)

| Item | Assumption |
| --- | --- |
| GPU `g6.xlarge`/`g5.xlarge` on-demand | Roughly USD 0.9-1.3 per hour -> about USD 650-950 for 24x7, about half if stopped outside store hours (6.9) |
| Ingestion `t3.small` + 30 GB gp3 + Elastic IP | About USD 25-35 |
| Internal ALB | About USD 20-25 + LCU |
| NAT gateway (only while downloading models) | About USD 35 per month if left running - remove after first start |
| S3 + KMS | 16 kHz PCM is about 115 MB per recorded hour; 7-day retention keeps this to a few dollars; KMS key USD 1 + requests |
| CloudWatch + Route 53 health check | About USD 5-15 |
| Bedrock Claude | Per-token price for the chosen model/region; budget about 15k input + 2k output tokens per 30-minute conversation |
