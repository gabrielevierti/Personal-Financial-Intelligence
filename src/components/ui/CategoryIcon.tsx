import {
  Briefcase, Building, Car, CircleDollarSign, Film, HeartPulse, Home, Landmark, Laptop, MoreHorizontal, Percent, Plane,
  PlusCircle, Repeat, RotateCcw, Shield, ShoppingBag, ShoppingBasket, Tag, Utensils, Zap, Gift, GraduationCap, PawPrint,
  Baby, Dumbbell, Music, Coffee, Smartphone, Wrench, type LucideIcon,
} from 'lucide-react';

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase, laptop: Laptop, building: Building, percent: Percent, 'rotate-ccw': RotateCcw,
  'plus-circle': PlusCircle, home: Home, 'shopping-basket': ShoppingBasket, car: Car, zap: Zap,
  'heart-pulse': HeartPulse, 'shopping-bag': ShoppingBag, utensils: Utensils, repeat: Repeat, plane: Plane,
  film: Film, shield: Shield, landmark: Landmark, 'more-horizontal': MoreHorizontal, tag: Tag, gift: Gift,
  'graduation-cap': GraduationCap, 'paw-print': PawPrint, baby: Baby, dumbbell: Dumbbell, music: Music,
  coffee: Coffee, smartphone: Smartphone, wrench: Wrench, dollar: CircleDollarSign,
};

export function CategoryIcon({ icon, size = 16, color }: { icon: string; size?: number; color?: string }) {
  const I = CATEGORY_ICONS[icon] ?? Tag;
  return <I size={size} color={color} aria-hidden="true" />;
}

export const PALETTE = ['#0969da', '#1a7f37', '#2da44e', '#1b7c83', '#8250df', '#a475f9', '#bf3989', '#cf222e', '#bc4c00', '#fb8f44', '#d4a72c', '#57606a'];
