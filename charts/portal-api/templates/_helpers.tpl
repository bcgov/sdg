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
