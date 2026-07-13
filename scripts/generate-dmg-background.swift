#!/usr/bin/env swift
import AppKit
import CoreGraphics
import Foundation

// Classic macOS drag-to-Applications DMG layout (600×400 @2x).
let width: CGFloat = 600
let height: CGFloat = 400
let scale: CGFloat = 2
let outPath = CommandLine.arguments.count > 1
  ? CommandLine.arguments[1]
  : "build/dmg-background.png"

let size = NSSize(width: width * scale, height: height * scale)
let image = NSImage(size: size)
image.lockFocus()

guard let ctx = NSGraphicsContext.current?.cgContext else {
  fputs("No graphics context\n", stderr)
  exit(1)
}

ctx.scaleBy(x: scale, y: scale)

// System window background (Big Sur+ installer gray)
ctx.setFillColor(CGColor(red: 0.96, green: 0.96, blue: 0.97, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))

// Subtle inner highlight along the top edge
ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.65))
ctx.setLineWidth(1)
ctx.move(to: CGPoint(x: 0, y: height - 0.5))
ctx.addLine(to: CGPoint(x: width, y: height - 0.5))
ctx.strokePath()

func drawCentered(_ text: String, in rect: CGRect, size: CGFloat, weight: NSFont.Weight, color: NSColor) {
  let para = NSMutableParagraphStyle()
  para.alignment = .center
  let attrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: size, weight: weight),
    .foregroundColor: color,
    .paragraphStyle: para,
  ]
  (text as NSString).draw(in: rect, withAttributes: attrs)
}

// Icon drop zones (labels sit under icons — Finder draws icon names)
// Main drag hint — matches Apple’s understated copy
drawCentered(
  "Drag Beacon to Applications",
  in: CGRect(x: 120, y: height - 248, width: 360, height: 18),
  size: 12,
  weight: .medium,
  color: NSColor(calibratedWhite: 0.25, alpha: 1)
)

// Apple-style curved arrow between icon centers (~180,210) → (~480,210)
ctx.saveGState()
ctx.setStrokeColor(CGColor(red: 0.45, green: 0.45, blue: 0.47, alpha: 0.42))
ctx.setLineWidth(1.5)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)

let arrow = CGMutablePath()
arrow.move(to: CGPoint(x: 248, y: 192))
arrow.addCurve(
  to: CGPoint(x: 412, y: 192),
  control1: CGPoint(x: 300, y: 228),
  control2: CGPoint(x: 360, y: 156)
)
ctx.addPath(arrow)
ctx.strokePath()

// Chevron head
ctx.setFillColor(CGColor(red: 0.45, green: 0.45, blue: 0.47, alpha: 0.5))
let head = CGMutablePath()
head.move(to: CGPoint(x: 412, y: 192))
head.addLine(to: CGPoint(x: 400, y: 186))
head.addLine(to: CGPoint(x: 400, y: 198))
head.closeSubpath()
ctx.addPath(head)
ctx.fillPath()
ctx.restoreGState()

// Footer note — secondary label style
drawCentered(
  "Recommended: double-click Install Beacon",
  in: CGRect(x: 40, y: 52, width: width - 80, height: 16),
  size: 11,
  weight: .semibold,
  color: NSColor(calibratedWhite: 0.35, alpha: 1)
)
drawCentered(
  "Clears the macOS security block on first launch",
  in: CGRect(x: 40, y: 36, width: width - 80, height: 14),
  size: 10,
  weight: .regular,
  color: NSColor(calibratedWhite: 0.55, alpha: 1)
)

image.unlockFocus()

guard
  let tiff = image.tiffRepresentation,
  let rep = NSBitmapImageRep(data: tiff),
  let png = rep.representation(using: .png, properties: [:])
else {
  fputs("Failed to encode PNG\n", stderr)
  exit(1)
}

try png.write(to: URL(fileURLWithPath: outPath))
print("Wrote \(outPath)")
