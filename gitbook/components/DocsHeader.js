"use client";

import { useState } from "react";
import Link from "next/link";
import { DOCS_CONFIG } from "@/constants/docsConfig";
import { DEFAULT_LANG } from "@/constants/languages";
import { Menu, X } from "lucide-react";
import DocsSidebar from "./DocsSidebar";
import LanguageSwitcher from "./LanguageSwitcher";

export default function DocsHeader({ lang = DEFAULT_LANG }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-sm border-gray-200">
        <div className=" mx-auto px-4 h-16 flex items-center justify-between">
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-6 h-6 text-gray-600" />
          </button>

          {/* Logo */}
          <Link href={`/${lang}`} className="flex items-center gap-2 font-bold text-2xl text-black hover:opacity-80 transition-opacity">
            <img src="/logo.svg" alt={DOCS_CONFIG.logo} className="h-8 w-auto" />
            <span className="text-[#176453]">Docs</span>
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher currentLang={lang} />
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <>
          <div
            className="mobile-menu-overlay lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          
          <div className="mobile-menu-drawer lg:hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <span className="font-bold text-lg text-black">
                {DOCS_CONFIG.logo} <span className="text-[#176453]">Docs</span>
              </span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>
            <DocsSidebar isMobile onClose={() => setMobileMenuOpen(false)} lang={lang} />
          </div>
        </>
      )}
    </>
  );
}
