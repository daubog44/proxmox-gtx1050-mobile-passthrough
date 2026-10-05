import { Channel, invoke } from "@tauri-apps/api/core";

export interface RecordingItem {
  id: string;
  file: string;
  username: string | null;
  date: string | null;
  time: string | null;
  size_mb: number;
  modified: number;
  storage: "nas" | "locale";
  in_progress: boolean;
  duration_s?: number | null;
  width?: number | null;
  height?: number | null;
  codec?: string | null;
}

export interface LiveInfo {
  capture: "gpu-screen-recorder" | "wf-recorder" | "wolf-tap" | null;
  encode: string | null;
  fallback: boolean;
  codec: string | null;
  readers: string[];
}

export interface UserStorageListing {
  path: string;
  items: { name: string; path: string; directory: boolean; size_bytes: number | null; modified: number }[];
  backups: SavegameManifest[];
  message?: string;
}

export type LiveVideoMessage = ArrayBuffer | { event: "end"; error?: string | null };
import type {
  Check,
  Dashboard,
  DisplayInfo,
  MultiUserOverview,
  SaveResult,
  SetupConfig,
  UpdateInfo,
  UpdateOutcome,
  AuthSession,
  NodeEntry,
  ApiTestResult,
  AdmissionStatus,
  VpnPeer,
  SavegameManifest,
  DesktopVpnStatus,
  NasTestResult,
  NasMountResult,
  TailscaleNode,
  DdnsStatus,
  PortSuggestion,
  StreamPortTestResult,
} from "../types";


export const api = {
  async sessionControl(sessionId: string, body: Record<string, unknown>, token: string): Promise<{lease?: string}> {
    return invoke("session_control", { sessionId, body, token });
  },
  async userStorage(username: string, body: Record<string, unknown>, token: string): Promise<UserStorageListing> {
    return invoke("user_storage", { username, body, token });
  },
  async downloadUserFile(username: string, relative: string, token: string, progress: (received: number, total?: number) => void): Promise<string> {
    const onProgress = new Channel<{received: number; total?: number}>();
    onProgress.onmessage = (m) => progress(m.received, m.total);
    return invoke("download_user_file", { username, relative, token, onProgress });
  },
  async inspectSetup(): Promise<Dashboard> {
    return invoke<Dashboard>("inspect_setup");
  },

  async discoverConfig(config: SetupConfig): Promise<SetupConfig> {
    return invoke<SetupConfig>("discover_config", { config });
  },

  async saveConfig(config: SetupConfig): Promise<SaveResult> {
    return invoke<SaveResult>("save_config", { config });
  },

  async checkReceiver(config: SetupConfig, sshPassword?: string | null): Promise<Check> {
    return invoke<Check>("check_receiver", { config, sshPassword: sshPassword || null });
  },

  async launchMoonlight(): Promise<string> {
    return invoke<string>("launch_moonlight");
  },

  async listDisplays(): Promise<DisplayInfo[]> {
    return invoke<DisplayInfo[]>("list_displays");
  },

  async configureMoonlightGaming(displayIndex: number, qualityMode: string): Promise<string> {
    return invoke<string>("configure_moonlight_gaming", { displayIndex, qualityMode });
  },

  async installDependency(dependencyId: string): Promise<string> {
    return invoke<string>("install_dependency", { dependencyId });
  },

  async runSetupInTerminal(sshPassword?: string | null, setupScope?: string): Promise<string> {
    return invoke<string>("run_setup_in_terminal", {
      sshPassword: sshPassword || null,
      setupScope: setupScope || "client",
    });
  },

  async getMultiUserDashboard(useFallback = true): Promise<MultiUserOverview> {
    return invoke<MultiUserOverview>("get_multi_user_dashboard", { useFallback });
  },

  async addMultiUser(
    username: string,
    displayName: string,
    pin: string,
    role = "guest",
    apps: string[] = ["steam"],
    maxBitrateMbps = 20,
    allowedNodes?: string[],
    token?: string,
    autoRecord = false,
    storageLimitGb = 0,
  ): Promise<string> {
    return invoke<string>("add_multi_user", {
      username,
      displayName,
      pin,
      role,
      apps,
      maxBitrateMbps,
      allowedNodes: allowedNodes || null,
      token: token || null,
      autoRecord,
      storageLimitGb,
    });
  },

  async pairMoonlightDevice(
    pin: string,
    name?: string,
    token?: string,
    target: "auto" | "sunshine" | "wolf" = "auto",
    username?: string,
    clientIp?: string,
  ): Promise<string> {
    return invoke<string>("pair_moonlight_device", {
      pin,
      name: name || null,
      token: token || null,
      target,
      username: username || null,
      clientIp: clientIp || null,
    });
  },

  async listRecordings(username?: string): Promise<RecordingItem[]> {
    return invoke<RecordingItem[]>("list_recordings", { username: username || null });
  },

  /** Saves a recording into ~/Downloads; `onProgress` gets bytes received/total. */
  async downloadRecording(
    id: string,
    fileName: string,
    username: string | null,
    onProgress: (received: number, total: number | null) => void,
  ): Promise<string> {
    const channel = new Channel<{ received: number; total: number | null }>();
    channel.onmessage = (m) => onProgress(m.received, m.total);
    return invoke<string>("download_recording", { id, fileName, username, onProgress: channel });
  },

  async cancelRecordingDownload(id: string): Promise<void> {
    return invoke<void>("cancel_recording_download", { id });
  },

  async revealInFileManager(path: string): Promise<void> {
    return invoke<void>("reveal_in_file_manager", { path });
  },

  async deleteRecording(id: string, token?: string): Promise<string> {
    return invoke<string>("delete_recording", { id, token: token || null });
  },

  async editMultiUser(
    username: string,
    opts: {
      newUsername?: string;
      displayName?: string;
      pin?: string;
      role?: string;
      apps?: string[];
      maxBitrateMbps?: number;
      allowedNodes?: string[];
      autoRecord?: boolean;
      storageLimitGb?: number;
    },
    token?: string,
  ): Promise<string> {
    return invoke<string>("edit_multi_user", {
      username,
      newUsername: opts.newUsername || null,
      displayName: opts.displayName || null,
      pin: opts.pin || null,
      role: opts.role || null,
      apps: opts.apps || null,
      maxBitrateMbps: opts.maxBitrateMbps ?? null,
      allowedNodes: opts.allowedNodes || null,
      autoRecord: opts.autoRecord ?? null,
      storageLimitGb: opts.storageLimitGb ?? null,
      token: token || null,
    });
  },

  async removeMultiUser(username: string, archive = false, token?: string): Promise<string> {
    return invoke<string>("remove_multi_user", { username, archive, token: token || null });
  },

  async banMultiUser(username: string, reason?: string, token?: string): Promise<string> {
    return invoke<string>("ban_multi_user", { username, reason: reason || null, token: token || null });
  },

  async unbanMultiUser(username: string, token?: string): Promise<string> {
    return invoke<string>("unban_multi_user", { username, token: token || null });
  },

  async killUserSession(sessionId: string, reason?: string): Promise<string> {
    return invoke<string>("kill_user_session", { sessionId, reason });
  },

  async takeoverUserSession(sessionId: string, token: string): Promise<string> {
    return invoke<string>("takeover_user_session", { token, sessionId });
  },

  async spectateUserSession(sessionId: string): Promise<string> {
    return invoke<string>("spectate_user_session", { sessionId });
  },

  async captureSessionFrame(sessionId: string): Promise<string> {
    return invoke<string>("capture_session_frame", { sessionId });
  },

  async getSessionStreamUrl(sessionId: string): Promise<string> {
    return invoke<string>("get_session_stream_url", { sessionId });
  },

  async startSessionRecording(sessionId: string): Promise<string> {
    return invoke<string>("start_session_recording", { sessionId });
  },

  async stopSessionRecording(sessionId: string): Promise<string> {
    return invoke<string>("stop_session_recording", { sessionId });
  },

  /**
   * Streams the session's low-latency fMP4 video. `onMessage` receives raw
   * ArrayBuffer chunks, then one `{ event: "end" }` object when the feed stops.
   */
  async startLiveVideo(sessionId: string, viewerId: string, onMessage: (msg: LiveVideoMessage) => void, quality = "original"): Promise<void> {
    const channel = new Channel<LiveVideoMessage>();
    channel.onmessage = onMessage;
    return invoke<void>("start_live_video", { sessionId, viewerId, onChunk: channel, quality });
  },

  /** WebRTC (WHEP) signalling relayed by the broker to MediaMTX. */
  async whepOffer(sessionId: string, sdp: string, quality = "original"): Promise<{ sdp: string; resource: string }> {
    return invoke<{ sdp: string; resource: string }>("whep_offer", { sessionId, sdp, quality });
  },

  async liveInfo(sessionId: string, quality = "original"): Promise<LiveInfo> {
    return invoke<LiveInfo>("live_info", { sessionId, quality });
  },

  async whepClose(sessionId: string, resource: string): Promise<void> {
    return invoke<void>("whep_close", { sessionId, resource });
  },

  async stopLiveVideo(viewerId: string): Promise<void> {
    return invoke<void>("stop_live_video", { viewerId });
  },

  async stopSessionStream(sessionId: string): Promise<string> {
    return invoke<string>("stop_session_stream", { sessionId });
  },

  async installMultiUserBackend(): Promise<string> {
    return invoke<string>("install_multi_user_backend");
  },

  async checkForUpdates(): Promise<UpdateInfo> {
    return invoke<UpdateInfo>("check_for_updates");
  },

  async installUpdate(downloadUrl: string): Promise<UpdateOutcome> {
    return invoke<UpdateOutcome>("install_update", { downloadUrl });
  },

  async finishUpdate(outcome: UpdateOutcome): Promise<void> {
    return invoke<void>("finish_update", { outcome });
  },

  async login(username: string, password: string): Promise<AuthSession> {
    return invoke<AuthSession>("login", { username, password });
  },

  async authNeedsSetup(): Promise<boolean> {
    return invoke<boolean>("auth_needs_setup");
  },

  async authSetup(password: string): Promise<AuthSession> {
    return invoke<AuthSession>("auth_setup", { password });
  },

  async validateSession(token: string): Promise<boolean> {
    return invoke<boolean>("validate_session", { token });
  },

  async logout(token: string): Promise<boolean> {
    return invoke<boolean>("logout", { token });
  },

  async listNodes(token?: string): Promise<NodeEntry[]> {
    return invoke<NodeEntry[]>("list_nodes", { token: token || null });
  },

  async switchNode(host: string, user?: string, sshPassword?: string, token?: string): Promise<SetupConfig> {
    return invoke<SetupConfig>("switch_node", {
      host,
      user: user || null,
      sshPassword: sshPassword || null,
      token: token || null,
    });
  },

  async addNodeEntry(
    name: string,
    host: string,
    user: string,
    sshPassword?: string,
    allowedUsers?: string[],
    token?: string,
    streamingPort?: number,
    ddnsDomain?: string,
  ): Promise<NodeEntry[]> {
    return invoke<NodeEntry[]>("add_node_entry", {
      name,
      host,
      user,
      sshPassword: sshPassword || null,
      allowedUsers: allowedUsers || null,
      token: token || null,
      streamingPort: streamingPort || 47989,
      ddnsDomain: ddnsDomain || null,
    });
  },

  async deleteNodeEntry(nodeId: string, token?: string): Promise<NodeEntry[]> {
    return invoke<NodeEntry[]>("delete_node_entry", {
      nodeId,
      token: token || null,
    });
  },

  async setNodeAllowedUsers(
    nodeId: string,
    allowedUsers: string[],
    token?: string,
  ): Promise<NodeEntry[]> {
    return invoke<NodeEntry[]>("set_node_allowed_users", {
      nodeId,
      allowedUsers,
      token: token || null,
    });
  },

  async getEnterpriseSettings(): Promise<Record<string, string>> {
    return invoke<Record<string, string>>("get_enterprise_settings");
  },

  async updateEnterpriseSetting(key: string, value: string, token?: string): Promise<string> {
    return invoke<string>("update_enterprise_setting", { key, value, token: token || null });
  },

  async checkAdmission(requestedVram?: number): Promise<AdmissionStatus> {
    return invoke<AdmissionStatus>("check_admission", { requestedVram: requestedVram || null });
  },

  async syncUserSavegames(username: string, direction?: "push" | "pull", token?: string): Promise<string> {
    return invoke<string>("sync_user_savegames", { username, direction: direction || null, token: token || null });
  },

  async listUserSavegames(username?: string, token?: string): Promise<SavegameManifest[]> {
    return invoke<SavegameManifest[]>("list_user_savegames", { username: username || null, token: token || null });
  },

  async createVpnPeer(username: string, clientName: string, token?: string): Promise<string> {
    return invoke<string>("create_vpn_peer", { username, clientName, token: token || null });
  },

  async listVpnPeers(username?: string, token?: string): Promise<VpnPeer[]> {
    return invoke<VpnPeer[]>("list_vpn_peers", { username: username || null, token: token || null });
  },

  async deleteVpnPeer(peerId: string, token?: string): Promise<string> {
    return invoke<string>("delete_vpn_peer", { peerId, token: token || null });
  },

  async pruneNasStorage(dryRun?: boolean, token?: string): Promise<string> {
    return invoke<string>("prune_nas_storage", { dryRun: dryRun ?? null, token: token || null });
  },

  async testVpnConnectivity(targetIp: string): Promise<string> {
    return invoke<string>("test_vpn_connectivity", { targetIp });
  },

  async getDesktopVpnStatus(): Promise<DesktopVpnStatus> {
    return invoke<DesktopVpnStatus>("get_desktop_vpn_status");
  },

  async connectDesktopVpn(token?: string): Promise<DesktopVpnStatus> {
    return invoke<DesktopVpnStatus>("connect_desktop_vpn", { token: token || null });
  },

  async disconnectDesktopVpn(): Promise<DesktopVpnStatus> {
    return invoke<DesktopVpnStatus>("disconnect_desktop_vpn");
  },

  async testSshConnection(host: string, user: string, sshPassword?: string): Promise<string> {
    return invoke<string>("test_ssh_connection", {
      host,
      user,
      sshPassword: sshPassword || null,
    });
  },

  async testNodeApi(
    host: string,
    port?: number,
    apiToken?: string,
  ): Promise<ApiTestResult> {
    return invoke<ApiTestResult>("test_node_api", {
      host,
      port: port || 47995,
      apiToken: apiToken || null,
    });
  },

  async testNasConnection(server: string, share: string, username?: string, password?: string): Promise<NasTestResult> {
    return invoke<NasTestResult>("test_nas_connection", {
      server,
      share,
      username: username || null,
      password: password || null,
    });
  },

  async mountNasStorage(server: string, share: string, mountpoint: string, username?: string, password?: string): Promise<NasMountResult> {
    return invoke<NasMountResult>("mount_nas_storage", {
      server,
      share,
      mountpoint,
      username: username || null,
      password: password || null,
    });
  },

  async getTailscaleNodes(): Promise<TailscaleNode[]> {
    return invoke<TailscaleNode[]>("get_tailscale_nodes");
  },

  async getPublicIp(): Promise<string> {
    return invoke<string>("get_public_ip");
  },

  async getDdnsStatus(): Promise<DdnsStatus> {
    return invoke<DdnsStatus>("get_ddns_status");
  },

  async updateDdnsConfig(domain: string, token: string, enabled: boolean): Promise<string> {
    return invoke<string>("update_ddns_config", { domain, token, enabled });
  },

  async saveNodeCredentials(
    nodeId: string,
    host: string,
    user: string,
    sshPassword?: string,
    apiPort?: number,
    apiToken?: string,
    token?: string,
    streamingPort?: number,
    ddnsDomain?: string,
  ): Promise<NodeEntry> {
    return invoke<NodeEntry>("save_node_credentials", {
      nodeId,
      host,
      user,
      sshPassword: sshPassword || null,
      apiPort: apiPort || 47995,
      apiToken: apiToken || null,
      token: token || null,
      streamingPort: streamingPort || 47989,
      ddnsDomain: ddnsDomain || null,
    });
  },

  async getSuggestedStreamingPort(
    host: string,
    ddnsDomain?: string | null,
    nodeId?: string | null,
  ): Promise<PortSuggestion> {
    return invoke<PortSuggestion>("get_suggested_streaming_port", {
      host,
      ddnsDomain: ddnsDomain || null,
      nodeId: nodeId || null,
    });
  },

  async testStreamPort(host: string, port: number): Promise<StreamPortTestResult> {
    return invoke<StreamPortTestResult>("test_stream_port", { host, port });
  },

  async openMoonlightUrl(url: string): Promise<string> {
    return invoke<string>("open_moonlight_url", { url });
  },
};
