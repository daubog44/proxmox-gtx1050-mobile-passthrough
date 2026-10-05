export type State = "ready" | "missing" | "blocked" | "unknown";

export type Check = {
  state: State;
  detail: string;
  install_command?: string | null;
};

export type Dependency = Check & {
  id: string;
  name: string;
};

export type SetupConfig = {
  vm_host: string;
  vm_address: string;
  user: string;
  client_address: string;
  rtp_port: string;
  microphone: string;
  fedora_source: string;
};

export type Dashboard = {
  platform: string;
  config_path: string;
  config: SetupConfig;
  checks: {
    moonlight: Check;
    ssh: Check;
    guest_receiver: Check;
    setup: Check;
  };
  dependencies: Dependency[];
  ssh_password_source?: "environment" | "config" | null;
};

export type SaveResult = {
  path: string;
  config: SetupConfig;
};

export type DisplayInfo = {
  index: number;
  name: string;
  width: number;
  height: number;
  scale_factor: number;
};

export type GpuTelemetry = {
  available: boolean;
  name: string;
  driver_version: string;
  gpu_utilization_pct: number;
  memory_used_mb: number;
  memory_total_mb: number;
  memory_free_mb: number;
  temperature_c: number;
  encoder_sessions_count: number;
  vram_status: "ok" | "warning" | "critical";
  cpu_utilization_pct?: number;
  ram_used_mb?: number;
  ram_total_mb?: number;
};

export type ActiveSession = {
  session_id: string;
  username: string;
  client_ip: string;
  app_name: string;
  resolution: string;
  fps: number;
  bitrate_kbps: number;
  vram_mb: number;
  started_at: number;
  state: "running" | "paused" | "shadowed" | "spectating";
  takeover_by?: string | null;
  is_recording: boolean;
  recording_file?: string | null;
};

export type UserRecord = {
  id: number;
  username: string;
  display_name: string;
  pin: string;
  role: "owner" | "guest" | "admin";
  allowed_apps: string[];
  allowed_nodes?: string[];
  max_bitrate_mbps: number;
  status: "active" | "archived" | "banned";
  created_at: number;
  auto_record?: boolean;
  storage_limit_gb?: number;
  storage_used_gb?: number | null;
  storage_quota_active?: boolean;
};

export type AdmissionStatus = {
  admitted: boolean;
  active_streams: number;
  max_concurrent_streams: number;
  free_vram_mb: number;
  requested_vram_mb: number;
  reason: string;
};

export type UserStorageUsage = {
  username: string;
  total_mb: number;
  snapshots_count: number;
};

export type StorageTelemetry = {
  nas_mounted: boolean;
  nas_path: string;
  nas_mountpoint?: string;
  storage_type: string;
  max_concurrent_streams: number;
  vpn_peers_count: number;
  savegame_snapshots_count: number;
  retention_recordings_days: number;
  nas_total_gb?: number;
  nas_free_gb?: number;
  recordings_mb?: number;
  recordings_count?: number;
  user_saves_breakdown?: UserStorageUsage[];
};

export type VpnPeer = {
  id: string;
  username: string;
  client_name: string;
  public_key: string;
  ip_address: string;
  created_at: number;
  status: string;
};

export type SavegameManifest = {
  id: number;
  username: string;
  snapshot_name: string;
  storage_type: string;
  file_path: string;
  size_bytes: number;
  created_at: number;
};

export type PruneResult = {
  status: string;
  dry_run: boolean;
  retention_recordings_days: number;
  pruned_recordings_count: number;
  freed_recordings_mb: number;
  storage_total_gb: number;
  storage_free_gb: number;
  nas_mounted: boolean;
};

export type NasTestResult = {
  status: string;
  accessible: boolean;
  server?: string;
  share?: string;
  port?: number;
  latency_ms?: number;
  auth_type?: string;
  message: string;
  error?: string;
};

export type NasMountResult = {
  status: string;
  mounted: boolean;
  server?: string;
  share?: string;
  mountpoint?: string;
  total_gb?: number;
  free_gb?: number;
  message: string;
  error?: string;
};

export type PendingPairing = {
  client_ip: string;
  target: "wolf" | "sunshine";
  username?: string | null;
};

export type MultiUserOverview = {
  status: string;
  timestamp: number;
  telemetry: GpuTelemetry;
  wolf_online: boolean;
  nas_mounted: boolean;
  nas_path: string;
  nas_mountpoint: string;
  active_sessions_count: number;
  registered_users_count: number;
  sessions: ActiveSession[];
  users: UserRecord[];
  /** Moonlight clients waiting for a pairing PIN (Wolf). */
  pair_pending?: PendingPairing[];
  admission?: AdmissionStatus;
  settings?: Record<string, string>;
  storage?: StorageTelemetry;
  vpn_peers?: VpnPeer[];
  savegames?: SavegameManifest[];
};

export type DesktopVpnStatus = {
  connected: boolean;
  ip_address: string;
  latency_ms: number | null;
  config_path: string;
  message: string;
};

export type UpdateInfo = {
  has_update: boolean;
  current_version: string;
  latest_version: string;
  release_date: string;
  notes: string;
  download_url?: string | null;
  reachable?: boolean;
};

export type UpdateOutcome = "restart" | "quit";

export type AuthSession = {
  token: string;
  username: string;
  role: string;
  expires_at: number;
};

export type NodeEntry = {
  id: string;
  name: string;
  host: string;
  user: string;
  is_active: boolean;
  connection_state?: "connected" | "auth_required" | "offline" | null;
  allowed_users?: string[];
  api_port?: number;
  api_token?: string | null;
  streaming_port?: number;
  ddns_domain?: string | null;
};

export type ApiTestResult = {
  ok: boolean;
  latency_ms: number;
  version: string;
  authenticated: boolean;
  message: string;
};

export type TailscaleNode = {
  hostname: string;
  dns_name: string;
  ip: string;
  os: string;
  online: boolean;
};

export type DdnsStatus = {
  status: string;
  enabled: boolean;
  domain: string;
  ip?: string;
  timestamp?: number;
  provider?: string;
  message?: string;
};

export type PortSuggestion = {
  port: number;
  is_conflict: boolean;
  conflicting_node?: string | null;
  reason: string;
};

export type StreamPortTestResult = {
  host: string;
  port: number;
  reachable: boolean;
  latency_ms: number;
  message: string;
};




