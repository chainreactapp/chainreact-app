"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { useAuthStore } from "@/stores/authStore"
import { isProfileAdmin } from "@/lib/types/admin"
import { useSidebarState } from "@/hooks/useSidebarState"
import { getNavSections, getActiveSectionId } from "@/lib/navigation/nav-config"
import { WorkspaceSelectionModal } from "@/components/workflows/WorkspaceSelectionModal"
import { useWorkflowCreation } from "@/hooks/useWorkflowCreation"
import { IconRail } from "./IconRail"
import { NavPanel } from "./NavPanel"

interface UnifiedSidebarProps {
  isMobileOpen?: boolean
  onMobileClose?: () => void
}

export function UnifiedSidebar({ isMobileOpen = false, onMobileClose }: UnifiedSidebarProps) {
  const pathname = usePathname()
  const { profile } = useAuthStore()
  const { isPanelOpen, activeSection, setActiveSection, setPanelOpen } = useSidebarState()
  const [isMounted, setIsMounted] = useState(false)

  const {
    showWorkspaceModal,
    handleWorkspaceSelected,
    handleCancelWorkspaceSelection,
  } = useWorkflowCreation()

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const isAdmin = profile ? isProfileAdmin(profile as any) : false
  const sections = getNavSections(isAdmin)

  // Derive active section from pathname
  useEffect(() => {
    if (!pathname) return
    const derivedSection = getActiveSectionId(pathname, sections)
    if (derivedSection && derivedSection !== activeSection) {
      setActiveSection(derivedSection)
    }
  }, [pathname, sections, activeSection, setActiveSection])

  // Close mobile drawer on navigation
  useEffect(() => {
    if (isMobileOpen) onMobileClose?.()
  }, [pathname])

  // Close mobile drawer on Escape
  useEffect(() => {
    if (!isMobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMobileClose?.()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isMobileOpen, onMobileClose])

  const currentSection = sections.find((s) => s.id === activeSection) ?? null

  const handleSectionClick = (sectionId: string) => {
    const section = sections.find((s) => s.id === sectionId)
    const hasMultipleChildren = section && section.children && section.children.length > 1

    if (!hasMultipleChildren) {
      // Single-child sections navigate directly, no panel
      setActiveSection(sectionId)
      setPanelOpen(false)
    } else if (sectionId === activeSection) {
      setPanelOpen(!isPanelOpen)
    } else {
      setActiveSection(sectionId)
      setPanelOpen(true)
    }
  }

  // Prevent hydration mismatch
  if (!isMounted) {
    return <div className="hidden md:flex h-full w-[84px] bg-orange-500 shrink-0" />
  }

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-hidden="true"
          onClick={onMobileClose}
        />
      )}

      <div
        className={
          // Desktop: in-flow flex child.
          // Mobile: hidden by default; when opened, fixed overlay on top of content.
          "flex h-full shrink-0 " +
          (isMobileOpen
            ? "fixed inset-y-0 left-0 z-50 md:relative md:z-auto"
            : "hidden md:flex")
        }
      >
        <IconRail
          sections={sections}
          activeSection={activeSection}
          onSectionClick={handleSectionClick}
        />
        {currentSection && currentSection.children && currentSection.children.length > 1 && (
          <NavPanel
            section={currentSection}
            isPanelOpen={isPanelOpen}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </div>

      <WorkspaceSelectionModal
        open={showWorkspaceModal}
        onOpenChange={(open) => { if (!open) handleCancelWorkspaceSelection() }}
        onWorkspaceSelected={handleWorkspaceSelected}
        onCancel={handleCancelWorkspaceSelection}
      />
    </>
  )
}
