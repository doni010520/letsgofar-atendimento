import {
  LayoutDashboard,
  BarChart3,
  MessageSquareText,
  LayoutGrid,
  Radio,
  Bot,
  Megaphone,
  Users,
  Layers,
  Settings,
  Plug,
  Tag,
  History,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    title: "Geral",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
    ],
  },
  {
    title: "Atendimento",
    items: [
      { href: "/canais", label: "Canais", icon: Radio },
      { href: "/atendimento", label: "Atendimento", icon: MessageSquareText },
      { href: "/atendimento-v2", label: "Atendimento V2", icon: LayoutGrid },
      { href: "/mensagens", label: "Mensagens", icon: Tag },
      { href: "/automacoes", label: "Automações", icon: Bot },
      { href: "/campanhas", label: "Campanhas", icon: Megaphone },
    ],
  },
  {
    title: "Empresa",
    items: [
      { href: "/atendentes", label: "Atendentes", icon: Users },
      { href: "/departamentos", label: "Departamentos", icon: Layers },
      { href: "/ajustes", label: "Ajustes", icon: Settings },
    ],
  },
  {
    title: "Integrações",
    items: [
      { href: "/integracoes", label: "Integrações", icon: Plug },
      { href: "/auditoria", label: "Auditoria", icon: History },
    ],
  },
];

export const ALL_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);
