/**
 * Semantic Lucide icon map for PyBotClass.
 * Consumers import only PbcIcon and pass semantic `name` keys.
 */
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CirclePlus,
  CircleUserRound,
  CircleX,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Code2,
  Copy,
  Download,
  EllipsisVertical,
  Eye,
  FilePlus2,
  FileText,
  House,
  Languages,
  LayoutGrid,
  Layers3,
  Link2,
  ListChecks,
  ListTodo,
  Menu,
  Moon,
  Paperclip,
  Pencil,
  Play,
  Presentation,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Sun,
  SunMoon,
  Table2,
  Trash2,
  TriangleAlert,
  Type,
  UserPlus,
  UserRound,
  UsersRound,
  Video,
} from "lucide-react";

const ICON_MAP = Object.freeze({
  home: House,
  courses: Layers3,
  /** Singular alias for course cards / course entry points (same glyph as courses). */
  course: Layers3,
  content: FileText,
  rubrics: ListChecks,
  community: UsersRound,
  ide: Code2,
  institution: Building2,
  create: CirclePlus,
  createContent: FilePlus2,
  addPerson: UserPlus,
  edit: Pencil,
  continue: Play,
  view: Eye,
  more: EllipsisVertical,
  duplicate: Copy,
  share: Share2,
  link: Link2,
  download: Download,
  delete: Trash2,
  attention: CircleAlert,
  pending: Clock3,
  toGrade: ClipboardCheck,
  completed: CircleCheck,
  notSubmitted: CircleMinus,
  warning: TriangleAlert,
  calendar: CalendarDays,
  error: CircleX,
  connected: CircleCheck,
  student: UserRound,
  teacher: Presentation,
  management: UsersRound,
  admin: Settings,
  lesson: BookOpen,
  exercise: ListTodo,
  quiz: CircleHelp,
  assignment: ClipboardList,
  evaluation: ChartNoAxesColumnIncreasing,
  video: Video,
  attachment: Paperclip,
  text: Type,
  sync: RefreshCw,
  search: Search,
  notifications: Bell,
  account: CircleUserRound,
  language: Languages,
  light: Sun,
  dark: Moon,
  system: SunMoon,
  menu: Menu,
  back: ArrowLeft,
  next: ArrowRight,
  grades: ChartNoAxesColumnIncreasing,
  submissions: ListChecks,
  tableView: Table2,
  cardView: LayoutGrid,
});

/**
 * @param {{
 *   name: keyof typeof ICON_MAP,
 *   size?: number | string,
 *   className?: string,
 *   [key: string]: unknown,
 * }} props
 */
export default function PbcIcon({ name, size = 20, className, ...rest }) {
  const Icon = ICON_MAP[name];
  if (!Icon) return null;

  return (
    <Icon
      size={size}
      className={className}
      color="currentColor"
      {...rest}
    />
  );
}

export { ICON_MAP as PBC_ICON_MAP };
