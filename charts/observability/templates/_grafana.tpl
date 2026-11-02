{{/* Grafana's Deployment (rendered from deployments.yaml): Keycloak login, secrets from Vault, provisioning from files/. */}}
{{- define "observability.grafanaDeployment" -}}
{{- $ := .context -}}
{{- $oidc := $.Values.grafana.oidc -}}
{{- $name := include "observability.name" (dict "context" $ "component" "grafana") -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ $name }}
  labels:
    {{- include "observability.labels" (dict "context" $ "component" "grafana") | nindent 4 }}
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector:
    matchLabels:
      {{- include "observability.selectorLabels" (dict "context" $ "component" "grafana") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "observability.labels" (dict "context" $ "component" "grafana") | nindent 8 }}
      annotations:
        checksum/config: {{ .config }}
        {{- if $.Values.vault.enabled }}
        {{- include "observability.vaultAnnotations" $ | nindent 8 }}
        {{- end }}
    spec:
      {{- if $.Values.vault.enabled }}
      serviceAccountName: {{ $.Values.vault.serviceAccountName | required "vault.serviceAccountName is required when vault.enabled is true" }}
      {{- else }}
      automountServiceAccountToken: false
      {{- end }}
      {{- include "observability.podSpec" $ | nindent 6 }}
      containers:
        - name: grafana
          image: {{ include "observability.image" (dict "context" $ "component" "grafana") }}
          imagePullPolicy: {{ $.Values.pullPolicy }}
          env:
            {{- include "observability.stackUrls" $ | nindent 12 }}
            - { name: GF_SERVER_ROOT_URL, value: {{ printf "https://%s" $.Values.grafana.host | quote }} }
            - { name: GF_PATHS_DATA, value: /var/lib/grafana }
            - { name: GF_PATHS_LOGS, value: /var/lib/grafana/log }
            - { name: GF_PATHS_PLUGINS, value: /var/lib/grafana/plugins }
            - { name: GF_ANALYTICS_REPORTING_ENABLED, value: 'false' }
            - { name: GF_ANALYTICS_CHECK_FOR_UPDATES, value: 'false' }
            # Only the plugins in the pinned image: no downloads or updates at startup. Grafana 13 otherwise fetches
            # ~550MB of plugin updates and apps on every start, which overflowed its emptyDir and got it evicted.
            - { name: GF_PLUGINS_PREINSTALL_DISABLED, value: 'true' }
            - { name: GF_AUTH_ANONYMOUS_ENABLED, value: 'false' }
            - { name: GF_AUTH_DISABLE_LOGIN_FORM, value: 'true' }
            - { name: GF_AUTH_GENERIC_OAUTH_ENABLED, value: 'true' }
            - { name: GF_AUTH_GENERIC_OAUTH_NAME, value: Keycloak }
            - { name: GF_AUTH_GENERIC_OAUTH_CLIENT_ID, value: {{ $oidc.clientId | required "grafana.oidc.clientId is required" | quote }} }
            - { name: GF_AUTH_GENERIC_OAUTH_SCOPES, value: openid email profile }
            - { name: GF_AUTH_GENERIC_OAUTH_AUTH_URL, value: {{ printf "%s/protocol/openid-connect/auth" .issuer | quote }} }
            - { name: GF_AUTH_GENERIC_OAUTH_TOKEN_URL, value: {{ printf "%s/protocol/openid-connect/token" .issuer | quote }} }
            - { name: GF_AUTH_GENERIC_OAUTH_API_URL, value: {{ printf "%s/protocol/openid-connect/userinfo" .issuer | quote }} }
            - { name: GF_AUTH_GENERIC_OAUTH_USE_PKCE, value: 'true' }
            - { name: GF_AUTH_GENERIC_OAUTH_ALLOW_SIGN_UP, value: 'true' }
            - { name: GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_PATH, value: {{ $oidc.roleAttributePath | quote }} }
            - { name: GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_STRICT, value: 'true' }
            {{- if $.Values.vault.enabled }}
            - { name: GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET__FILE, value: /vault/secrets/oidc-client-secret }
            - { name: GF_SECURITY_ADMIN_PASSWORD__FILE, value: /vault/secrets/admin-password }
            {{- else }}
            - name: GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET
              valueFrom: { secretKeyRef: { name: {{ $.Values.existingSecret }}, key: OIDC_CLIENT_SECRET } }
            - name: GF_SECURITY_ADMIN_PASSWORD
              valueFrom: { secretKeyRef: { name: {{ $.Values.existingSecret }}, key: ADMIN_PASSWORD } }
            {{- end }}
          ports:
            - { name: http, containerPort: 3000, protocol: TCP }
          readinessProbe:
            httpGet: { path: /api/health, port: http }
          securityContext:
            {{- include "common.containerSecurityContext" $ | nindent 12 }}
          resources:
            {{- toYaml $.Values.resources.grafana | nindent 12 }}
          volumeMounts:
            - { name: data, mountPath: /var/lib/grafana }
            - { name: provisioning, mountPath: /etc/grafana/provisioning, readOnly: true }
            - { name: dashboards, mountPath: /var/lib/grafana/dashboards, readOnly: true }
            - { name: tmp, mountPath: /tmp }
      volumes:
        {{- include "observability.dataVolume" (dict "context" $ "component" "grafana") | nindent 8 }}
        - name: provisioning
          configMap:
            name: {{ $name }}
            items:
              - { key: datasources.yaml, path: datasources/datasources.yaml }
              - { key: dashboards.yaml, path: dashboards/dashboards.yaml }
        - name: dashboards
          configMap:
            name: {{ $name }}
            items:
              {{- range $path, $_ := $.Files.Glob "files/grafana/dashboards/*.json" }}
              - { key: {{ printf "dashboard-%s" (base $path) }}, path: {{ base $path }} }
              {{- end }}
        - name: tmp
          emptyDir: { sizeLimit: 64Mi }
{{- end -}}
