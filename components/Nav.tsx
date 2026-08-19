'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: '今日打卡' },
  { href: '/calendar', label: '日历' },
  { href: '/goals', label: '目标' },
  { href: '/videos', label: '视频库' },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={pathname === link.href ? 'active' : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
