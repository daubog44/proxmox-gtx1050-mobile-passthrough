import {
  Globe,
  Server,
  HardDrive,
  Cpu,
  Users,
  User,
  Monitor,
  Activity,
  Zap,
  Copy,
  ExternalLink,
  QrCode,
  RefreshCw,
  Trash2,
  Settings,
  CheckCircle2,
  AlertCircle,
  Play,
  Share2,
  Lock,
  Eye,
  Sliders,
  Radio,
  Wifi,
  Send,
  Film,
  Download,
  LayoutDashboard,
  FolderOpen,
  Cloud,
  Check,
  Gamepad2,
  Square,
  CircleDot,
  Shield,
  Key,
  Wrench,
  Layers,
  ChevronDown,
  X,
  Power,
} from "lucide";

type IconElement = readonly [string, Record<string, string | number | undefined>];

export function renderIcon(iconDef: readonly IconElement[], className: string = "w-4 h-4"): string {
  const defaultAttrs = {
    xmlns: "http://www.w3.org/2000/svg",
    width: "24",
    height: "24",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    class: className,
  };
  const attrStr = Object.entries(defaultAttrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  const children = iconDef
    .map(([tag, attrs]) => {
      const aStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `<${tag} ${aStr}/>`;
    })
    .join("");
  return `<svg ${attrStr}>${children}</svg>`;
}

export const Icons = {
  globe: (cls = "w-4 h-4") => renderIcon(Globe, cls),
  server: (cls = "w-4 h-4") => renderIcon(Server, cls),
  hardDrive: (cls = "w-4 h-4") => renderIcon(HardDrive, cls),
  cpu: (cls = "w-4 h-4") => renderIcon(Cpu, cls),
  users: (cls = "w-4 h-4") => renderIcon(Users, cls),
  user: (cls = "w-4 h-4") => renderIcon(User, cls),
  monitor: (cls = "w-4 h-4") => renderIcon(Monitor, cls),
  activity: (cls = "w-4 h-4") => renderIcon(Activity, cls),
  zap: (cls = "w-4 h-4") => renderIcon(Zap, cls),
  copy: (cls = "w-4 h-4") => renderIcon(Copy, cls),
  externalLink: (cls = "w-4 h-4") => renderIcon(ExternalLink, cls),
  qrCode: (cls = "w-4 h-4") => renderIcon(QrCode, cls),
  refresh: (cls = "w-4 h-4") => renderIcon(RefreshCw, cls),
  trash: (cls = "w-4 h-4") => renderIcon(Trash2, cls),
  settings: (cls = "w-4 h-4") => renderIcon(Settings, cls),
  checkCircle: (cls = "w-4 h-4") => renderIcon(CheckCircle2, cls),
  alertCircle: (cls = "w-4 h-4") => renderIcon(AlertCircle, cls),
  play: (cls = "w-4 h-4") => renderIcon(Play, cls),
  share: (cls = "w-4 h-4") => renderIcon(Share2, cls),
  lock: (cls = "w-4 h-4") => renderIcon(Lock, cls),
  eye: (cls = "w-4 h-4") => renderIcon(Eye, cls),
  sliders: (cls = "w-4 h-4") => renderIcon(Sliders, cls),
  radio: (cls = "w-4 h-4") => renderIcon(Radio, cls),
  wifi: (cls = "w-4 h-4") => renderIcon(Wifi, cls),
  send: (cls = "w-4 h-4") => renderIcon(Send, cls),
  folder: (cls = "w-4 h-4") => renderIcon(FolderOpen, cls),
  cloud: (cls = "w-4 h-4") => renderIcon(Cloud, cls),
  check: (cls = "w-4 h-4") => renderIcon(Check, cls),
  gamepad: (cls = "w-4 h-4") => renderIcon(Gamepad2, cls),
  square: (cls = "w-4 h-4") => renderIcon(Square, cls),
  circleDot: (cls = "w-4 h-4") => renderIcon(CircleDot, cls),
  shield: (cls = "w-4 h-4") => renderIcon(Shield, cls),
  key: (cls = "w-4 h-4") => renderIcon(Key, cls),
  wrench: (cls = "w-4 h-4") => renderIcon(Wrench, cls),
  layers: (cls = "w-4 h-4") => renderIcon(Layers, cls),
  chevronDown: (cls = "w-4 h-4") => renderIcon(ChevronDown, cls),
  x: (cls = "w-4 h-4") => renderIcon(X, cls),
  power: (cls = "w-4 h-4") => renderIcon(Power, cls),
  film: (cls = "w-4 h-4") => renderIcon(Film, cls),
  download: (cls = "w-4 h-4") => renderIcon(Download, cls),
  dashboard: (cls = "w-4 h-4") => renderIcon(LayoutDashboard, cls),
};
