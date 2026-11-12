{{/*
Shared helpers for the sdg charts (charts/README.md). Every chart depends on this library.
*/}}

{{- define "common.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
<release>-<chart>, never collapsed when the release name contains the chart name: other charts compute these
names (edge upstreams, portal-api secret refs, NetworkPolicy peers) and must get the same answer.
*/}}
{{- define "common.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "common.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Selector labels: name + instance only, because a Deployment's selector is immutable. */}}
{{- define "common.selectorLabels" -}}
app.kubernetes.io/name: {{ include "common.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Peer selector for a sibling chart in the same release: (dict "name" "edge" "context" $). */}}
{{- define "common.peerSelectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .context.Release.Name }}
{{- end -}}

{{/* Usage: include "common.labels" (dict "context" $ "component" "api"); component is optional. */}}
{{- define "common.labels" -}}
{{- $ctx := .context -}}
helm.sh/chart: {{ include "common.chart" $ctx }}
{{ include "common.selectorLabels" $ctx }}
{{- with $ctx.Chart.AppVersion }}
app.kubernetes.io/version: {{ . | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ $ctx.Release.Service }}
app.kubernetes.io/part-of: sdg
{{- with .component }}
app.kubernetes.io/component: {{ . }}
{{- end }}
{{- end -}}

{{/*
<registry>/<name>:<tag>. Registry and tag fall back to global.image; both are required.
Usage: include "common.image" (dict "image" .Values.image "context" $)
*/}}
{{- define "common.image" -}}
{{- $global := (.context.Values.global | default dict).image | default dict -}}
{{- $registry := .image.registry | default $global.registry | required "image registry is required: set global.image.registry (or image.registry)" -}}
{{- $tag := .image.tag | default $global.tag | required "image tag is required: set global.image.tag (or image.tag)" -}}
{{- printf "%s/%s:%s" (trimSuffix "/" $registry) .image.name $tag -}}
{{- end -}}

{{/* OpenShift's restricted-v2 SCC assigns runAsUser and fsGroup, so neither is set. */}}
{{- define "common.podSecurityContext" -}}
runAsNonRoot: true
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "common.containerSecurityContext" -}}
allowPrivilegeEscalation: false
capabilities:
  drop: [ALL]
readOnlyRootFilesystem: true
{{- end -}}

{{/* Renders a value through tpl so defaults can reference .Release.Name. Usage: include "common.tplvalue" (dict "value" .Values.x "context" $) */}}
{{- define "common.tplvalue" -}}
{{- tpl (toString .value) .context -}}
{{- end -}}

{{/* minAvailable 1 PodDisruptionBudget, rendered only when podDisruptionBudget.enabled. */}}
{{- define "common.pdb" -}}
{{- if .Values.podDisruptionBudget.enabled }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "common.fullname" . }}
  labels:
    {{- include "common.labels" (dict "context" .) | nindent 4 }}
spec:
  minAvailable: {{ .Values.podDisruptionBudget.minAvailable }}
  selector:
    matchLabels:
      {{- include "common.selectorLabels" . | nindent 6 }}
{{- end }}
{{- end -}}

{{/*
Observability (doc 20). global.observability left empty renders nothing: no telemetry env, annotations or rules.
  collectorHost          Alloy's Service host, e.g. observability-alloy.abc123-tools.svc (OTLP :4318, Faro :12347)
  scraperNamespace       namespace of the Alloy that scrapes this release, e.g. abc123-tools (prod: abc123-prod)
  environment            pr-<n> | test | prod, the same on every signal
*/}}
{{- define "common.observability" -}}
{{- toYaml ((.Values.global | default dict).observability | default dict) -}}
{{- end -}}

{{/* Pod annotations Alloy discovers. Usage: include "common.scrapeAnnotations" (dict "context" $ "port" 3000) */}}
{{- define "common.scrapeAnnotations" -}}
{{- $o := include "common.observability" .context | fromYaml -}}
{{- if $o.scraperNamespace -}}
sdg.gov.bc.ca/scrape: 'true'
sdg.gov.bc.ca/scrape-port: {{ .port | quote }}
sdg.gov.bc.ca/scrape-path: /metrics
{{- with $o.environment }}
sdg.gov.bc.ca/environment: {{ . | quote }}
{{- end }}
{{- end -}}
{{- end -}}

{{/* NetworkPolicy ingress rule admitting the scraping Alloy. Usage: include "common.scraperIngressRule" (dict "context" $ "port" 3000) */}}
{{- define "common.scraperIngressRule" -}}
{{- $o := include "common.observability" .context | fromYaml -}}
{{- with $o.scraperNamespace -}}
- from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: {{ . }}
      podSelector:
        matchLabels:
          app.kubernetes.io/name: alloy
  ports:
    - port: {{ $.port }}
      protocol: TCP
{{- end -}}
{{- end -}}

{{/*
Postgres connection env for a service with its own login (charts/postgres users): DATABASE_URL from that login's PGO
Secret, PGSSLMODE, and PGO's CA through NODE_EXTRA_CA_CERTS when database.caSecretName is set. Reads .Values.database:
secretName (rendered with tpl, e.g. '{{ .Release.Name }}-postgres-pguser-core'), secretKey, sslMode, caSecretName.
*/}}
{{- define "common.databaseUrlEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "common.tplvalue" (dict "value" .Values.database.secretName "context" .) }}
      key: {{ .Values.database.secretKey }}
- name: PGSSLMODE
  value: {{ .Values.database.sslMode | quote }}
{{- if .Values.database.caSecretName }}
- name: NODE_EXTRA_CA_CERTS
  value: /etc/postgres-ca/ca.crt
{{- end }}
{{- end -}}

{{/* The volumeMount for PGO's CA (common.postgresCaVolume); empty without database.caSecretName. */}}
{{- define "common.postgresCaMount" -}}
{{- if .Values.database.caSecretName -}}
- name: postgres-ca
  mountPath: /etc/postgres-ca
  readOnly: true
{{- end -}}
{{- end -}}

{{/* The volume holding PGO's CA (database.caSecretName, key database.caSecretKey); empty without database.caSecretName. */}}
{{- define "common.postgresCaVolume" -}}
{{- if .Values.database.caSecretName -}}
- name: postgres-ca
  secret:
    secretName: {{ include "common.tplvalue" (dict "value" .Values.database.caSecretName "context" .) }}
    items:
      - key: {{ .Values.database.caSecretKey }}
        path: ca.crt
{{- end -}}
{{- end -}}
