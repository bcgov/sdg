{{- define "portal-api.appUrl" -}}
{{- $host := (.Values.global | default dict).host -}}
{{- if .Values.appUrl -}}
{{- .Values.appUrl -}}
{{- else if $host -}}
{{- printf "https://%s" $host -}}
{{- else -}}
{{- fail "appUrl or global.host is required" -}}
{{- end -}}
{{- end -}}

{{- define "portal-api.databaseUrlEnv" -}}
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

{{- define "portal-api.postgresCaMount" -}}
{{- if .Values.database.caSecretName -}}
- name: postgres-ca
  mountPath: /etc/postgres-ca
  readOnly: true
{{- end -}}
{{- end -}}

{{/* Vault Agent template: one dotenv line per key. The Vault braces are emitted literally, not run by Helm. */}}
{{- define "portal-api.vaultTemplate" -}}
{{ printf "{{- with secret %q }}" .Values.vault.secretPath }}
{{- range .Values.vault.keys }}
{{- if not (regexMatch "^[A-Z0-9_]+$" .) }}
{{- fail (printf "vault.keys entries must match ^[A-Z0-9_]+$, got %q" .) }}
{{- end }}
{{ printf "%s='{{ index .Data.data %q }}'" . . }}
{{- end }}
{{ "{{- end }}" }}
{{- end -}}

{{- define "portal-api.vaultAnnotations" -}}
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
vault.hashicorp.com/agent-inject-secret-portal-api.env: {{ .Values.vault.secretPath | required "vault.secretPath is required when vault.enabled is true" | quote }}
vault.hashicorp.com/agent-inject-template-portal-api.env: |
  {{- include "portal-api.vaultTemplate" . | nindent 2 }}
{{- end -}}
