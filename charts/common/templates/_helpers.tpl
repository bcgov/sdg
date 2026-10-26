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
