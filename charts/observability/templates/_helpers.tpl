{{/*
Names are <release>-<component> (observability-alloy, observability-grafana, ...): the app charts reach Alloy as
<release>-alloy and select it by app.kubernetes.io/name: alloy (charts/sdg global.observability).
*/}}
{{- define "observability.name" -}}
{{- printf "%s-%s" (.context.Values.fullnameOverride | default .context.Release.Name) .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Usage: include "observability.selectorLabels" (dict "context" $ "component" "alloy") */}}
{{- define "observability.selectorLabels" -}}
app.kubernetes.io/name: {{ .component }}
app.kubernetes.io/instance: {{ .context.Release.Name }}
{{- end -}}

{{- define "observability.labels" -}}
helm.sh/chart: {{ include "common.chart" .context }}
{{ include "observability.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .context.Release.Service }}
app.kubernetes.io/part-of: sdg-observability
{{- end -}}

{{- define "observability.image" -}}
{{- $image := index .context.Values.images .component -}}
{{- printf "%s:%s" $image.repository $image.tag -}}
{{- end -}}

{{/* In-cluster URL of a component's HTTP port. Usage: include "observability.url" (dict "context" $ "component" "loki" "port" 3100) */}}
{{- define "observability.url" -}}
{{- printf "http://%s:%v" (include "observability.name" .) .port -}}
{{- end -}}

{{- define "observability.stackUrls" -}}
- name: PROMETHEUS_URL
  value: {{ include "observability.url" (dict "context" . "component" "prometheus" "port" 9090) }}
- name: LOKI_URL
  value: {{ include "observability.url" (dict "context" . "component" "loki" "port" 3100) }}
- name: TEMPO_URL
  value: {{ include "observability.url" (dict "context" . "component" "tempo" "port" 3200) }}
- name: TEMPO_OTLP_URL
  value: {{ include "observability.url" (dict "context" . "component" "tempo" "port" 4318) }}
{{- end -}}

{{- define "observability.sourceNamespaces" -}}
{{- $namespaces := .Values.sources.namespaces -}}
{{- if empty $namespaces }}{{ fail "sources.namespaces is required: the namespaces this stack collects from" }}{{ end -}}
{{- if not (kindIs "slice" $namespaces) }}{{ fail "sources.namespaces must be a list" }}{{ end -}}
{{- range $namespaces }}{{ if not (regexMatch "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$" .) }}{{ fail (printf "sources.namespaces: invalid namespace %q" .) }}{{ end }}{{ end -}}
{{- join "," $namespaces -}}
{{- end -}}

{{/* Pod-level settings shared by every component. */}}
{{- define "observability.podSpec" -}}
securityContext:
  {{- include "common.podSecurityContext" . | nindent 2 }}
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{/* Grafana's two secrets as files under /vault/secrets (pre-populate only, like portal-api). */}}
{{- define "observability.vaultAnnotations" -}}
{{- $path := .Values.vault.secretPath | required "vault.secretPath is required when vault.enabled is true" -}}
vault.hashicorp.com/agent-inject: 'true'
vault.hashicorp.com/agent-pre-populate-only: 'true'
vault.hashicorp.com/agent-inject-token: 'false'
vault.hashicorp.com/agent-requests-cpu: {{ .Values.vault.agentResources.requests.cpu | quote }}
vault.hashicorp.com/agent-requests-mem: {{ .Values.vault.agentResources.requests.memory | quote }}
vault.hashicorp.com/agent-limits-cpu: {{ .Values.vault.agentResources.limits.cpu | quote }}
vault.hashicorp.com/agent-limits-mem: {{ .Values.vault.agentResources.limits.memory | quote }}
vault.hashicorp.com/role: {{ .Values.vault.role | required "vault.role is required when vault.enabled is true" | quote }}
vault.hashicorp.com/auth-path: {{ .Values.vault.authPath | quote }}
vault.hashicorp.com/namespace: {{ .Values.vault.namespace | quote }}
{{- range $file, $key := dict "oidc-client-secret" "OIDC_CLIENT_SECRET" "admin-password" "ADMIN_PASSWORD" }}
vault.hashicorp.com/agent-inject-secret-{{ $file }}: {{ $path | quote }}
vault.hashicorp.com/agent-inject-template-{{ $file }}: {{ printf "{{- with secret %q }}{{ index .Data.data %q }}{{- end }}" $path $key | quote }}
{{- end }}
{{- end -}}

{{/* A component's data volume: its PVC, or a size-capped emptyDir when persistence is off. Usage: include "observability.dataVolume" (dict "context" $ "component" "loki") */}}
{{- define "observability.dataVolume" -}}
{{- $p := index .context.Values.persistence .component -}}
- name: data
{{- if $p.enabled }}
  persistentVolumeClaim:
    claimName: {{ include "observability.name" . }}
{{- else }}
  emptyDir:
    sizeLimit: {{ $p.size }}
{{- end }}
{{- end -}}
