{{/*
One of the edge's public hosts: ingress.<key>, else global.<key>, else empty.
Usage: include "edge.host" (list . "consoleHost")  (keys: host, consoleHost, gatewayHost)
*/}}
{{- define "edge.host" -}}
{{- $context := index . 0 -}}
{{- $key := index . 1 -}}
{{- index $context.Values.ingress $key | default (index ($context.Values.global | default dict) $key) | default "" -}}
{{- end -}}
