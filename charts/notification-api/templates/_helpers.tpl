{{/*
Roles this release runs, one Deployment each (KTD1): split = api + worker, combined = all.
Usage: include "notification-api.roles" $ | fromJsonArray
*/}}
{{- define "notification-api.roles" -}}
{{- if eq .Values.mode "split" -}}
{{- list "api" "worker" | toJson -}}
{{- else if eq .Values.mode "combined" -}}
{{- list "all" | toJson -}}
{{- else -}}
{{- fail (printf "mode must be split or combined, got %q" .Values.mode) -}}
{{- end -}}
{{- end -}}

{{/* The role behind the Service and the PodDisruptionBudget: api (split) or all (combined). */}}
{{- define "notification-api.servedRole" -}}
{{- if eq .Values.mode "combined" }}all{{ else }}api{{ end -}}
{{- end -}}

{{/*
Selector labels for one role's pods. The component label keeps api and worker from selecting each other's pods;
app.kubernetes.io/name stays notification-api on every pod, so NetworkPolicy peers match all of them.
Usage: include "notification-api.selectorLabels" (dict "context" $ "role" "api")
*/}}
{{- define "notification-api.selectorLabels" -}}
{{ include "common.selectorLabels" .context }}
app.kubernetes.io/component: {{ .role }}
{{- end -}}

{{/* <fullname>-api and <fullname>-worker in split mode, <fullname> for all. The Service is always <fullname>. */}}
{{- define "notification-api.deploymentName" -}}
{{- $fullname := include "common.fullname" .context -}}
{{- if eq .role "all" -}}
{{- $fullname -}}
{{- else -}}
{{- printf "%s-%s" $fullname .role | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
