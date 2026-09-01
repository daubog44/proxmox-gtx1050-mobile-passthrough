Name:           omarchy-fedora-client
Version:        %{?version}%{!?version:0.1.0}
Release:        1%{?dist}
Summary:        Moonlight and on-demand microphone client for an Omarchy VM
License:        LicenseRef-Proprietary
BuildArch:      noarch
Requires:       bash
Requires:       coreutils
Requires:       /usr/bin/ffmpeg
Requires:       flatpak
Requires:       iproute
Requires:       kde-connect
Requires:       openssh-clients
Requires:       pipewire-pulseaudio
Requires:       pulseaudio-utils
Requires:       systemd

%description
Client-side installer for an Omarchy/Sunshine VM. The omarchy-onboard command
starts a local configuration wizard, installs Moonlight and an on-demand
Opus/RTP microphone watcher, and automatically bootstraps the matching
receiver in the VM through SSH. Every run reapplies the managed guest files
idempotently so an installed but older receiver is upgraded too.

%prep

%build

%install
rm -rf %{buildroot}
install -Dpm0755 %{_sourcedir}/scripts/omarchy-setup \
  %{buildroot}%{_libexecdir}/omarchy-fedora-client/scripts/omarchy-setup
install -Dpm0755 %{_sourcedir}/scripts/omarchy-gtx-primary \
  %{buildroot}%{_libexecdir}/omarchy-fedora-client/scripts/omarchy-gtx-primary
install -Dpm0755 %{_sourcedir}/scripts/omarchy-nvidia-pascal-branch \
  %{buildroot}%{_libexecdir}/omarchy-fedora-client/scripts/omarchy-nvidia-pascal-branch
install -Dpm0755 %{_sourcedir}/scripts/voxtype-remote-mic-rtp-receive \
  %{buildroot}%{_libexecdir}/omarchy-fedora-client/scripts/voxtype-remote-mic-rtp-receive
install -Dpm0755 %{_sourcedir}/scripts/voxtype-remote-mic-control-follow \
  %{buildroot}%{_libexecdir}/omarchy-fedora-client/scripts/voxtype-remote-mic-control-follow
install -Dpm0755 %{_sourcedir}/scripts/voxtype-remote-mic-demand \
  %{buildroot}%{_libexecdir}/omarchy-fedora-client/scripts/voxtype-remote-mic-demand
install -Dpm0755 %{_sourcedir}/scripts/voxtype-remote-mic-ssh-dispatch \
  %{buildroot}%{_libexecdir}/omarchy-fedora-client/scripts/voxtype-remote-mic-ssh-dispatch
install -Dpm0644 %{_sourcedir}/systemd/voxtype-remote-mic-rtp.service \
  %{buildroot}%{_libexecdir}/omarchy-fedora-client/systemd/voxtype-remote-mic-rtp.service
install -Dpm0755 %{_sourcedir}/clients/omarchy-client-setup-fedora.sh \
  %{buildroot}%{_libexecdir}/omarchy-fedora-client/clients/omarchy-client-setup-fedora.sh
install -Dpm0755 %{_sourcedir}/clients/voxtype-fedora-mic-rtp.sh \
  %{buildroot}%{_libexecdir}/omarchy-fedora-client/clients/voxtype-fedora-mic-rtp.sh
install -Dpm0644 %{_sourcedir}/systemd/voxtype-fedora-mic-rtp.service \
  %{buildroot}%{_libexecdir}/omarchy-fedora-client/systemd/voxtype-fedora-mic-rtp.service
install -Dpm0755 %{_sourcedir}/packaging/omarchy-onboard \
  %{buildroot}%{_bindir}/omarchy-onboard
install -Dpm0755 %{_sourcedir}/packaging/omarchy-client-check \
  %{buildroot}%{_bindir}/omarchy-client-check

%files
%{_bindir}/omarchy-onboard
%{_bindir}/omarchy-client-check
%{_libexecdir}/omarchy-fedora-client

%changelog
* Mon Aug 31 2026 Omarchy setup <noreply@example.invalid> - %{version}-1
- Initial standalone Fedora client package
