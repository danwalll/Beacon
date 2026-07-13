#!/usr/bin/env swift
import AppKit
import CoreGraphics
import Foundation

let width: CGFloat = 660
let height: CGFloat = 420
let scale: CGFloat = 2
let outPath = CommandLine.arguments.count > 1
  ? CommandLine.arguments[1]
  : "build/dmg-background.png"
let iconPath = CommandLine.arguments.count > 2
  ? CommandLine.arguments[2]
  : "build/icon-1024.png"

let size = NSSize(width: width * scale, height: height * scale)
let image = NSImage(size: size)
image.lockFocus()

guard let ctx = NSGraphicsContext.current?.cgContext else {
  fputs("No graphics context\n", stderr)
  exit(1)
}

ctx.scaleBy(x: scale, y: scale)

// Background gradient — warm window like macOS installer
let colors = [
  CGColor(red: 0.98, green: 0.97, blue: 0.95, alpha: 1),
  CGColor(red: 0.94, green: 0.93, blue: 0.90, alpha: 1),
  CGColor(red: 0.90, green: 0.88, blue: 0.84, alpha: 1),
] as CFArray
let space = CGColorSpaceCreateDeviceRGB()
if let gradient = CGGradient(colorsSpace: space, colors: colors, locations: [0, 0.55, 1]) {
  ctx.drawLinearGradient(
    gradient,
    start: CGPoint(x: width / 2, y: 0),
    end: CGPoint(x: width / 2, y: height),
    options: []
  )
}

// Soft amber glow behind app icon area
ctx.saveGState()
let glowRect = CGRect(x: 70, y: 120, width: 180, height: 180)
ctx.setFillColor(CGColor(red: 0.95, green: 0.62, blue: 0.18, alpha: 0.18))
ctx.fillEllipse(in: glowRect)
ctx.restoreGState()

// App icon preview in the drag zone
if let icon = NSImage(contentsOfFile: iconPath) {
  let iconSide: CGFloat = 88
  let iconRect = CGRect(x: 116, y: 154, width: iconSide, height: iconSide)
  ctx.saveGState()
  let iconPathShape = CGPath(
    roundedRect: iconRect,
    cornerWidth: 18,
    cornerHeight: 18,
    transform: nil
  )
  ctx.addPath(iconPathShape)
  ctx.clip()
  icon.draw(in: iconRect)
  ctx.restoreGState()
}

// Title
let titleAttrs: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 28, weight: .bold),
  .foregroundColor: NSColor(calibratedWhite: 0.08, alpha: 1),
]
("Beacon" as NSString).draw(
  at: CGPoint(x: 36, y: height - 58),
  withAttributes: titleAttrs
)

let subtitleAttrs: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 14, weight: .regular),
  .foregroundColor: NSColor(calibratedWhite: 0.35, alpha: 1),
]
("Know when your AI needs you" as NSString).draw(
  at: CGPoint(x: 38, y: height - 82),
  withAttributes: subtitleAttrs
)

// Step labels baked into background
func drawStep(_ text: String, at point: CGPoint, bold: String? = nil) {
  let para = NSMutableParagraphStyle()
  para.alignment = .center
  let full = text as NSString
  let attrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 12, weight: .semibold),
    .foregroundColor: NSColor(calibratedWhite: 0.22, alpha: 1),
    .paragraphStyle: para,
  ]
  full.draw(in: CGRect(x: point.x, y: point.y, width: 200, height: 40), withAttributes: attrs)
}

drawStep("Drag to Applications", at: CGPoint(x: 95, y: 88))
drawStep("or double-click below", at: CGPoint(x: 95, y: 72))

// Curved arrow from app zone to Applications
ctx.saveGState()
ctx.setStrokeColor(CGColor(red: 0.55, green: 0.55, blue: 0.55, alpha: 0.55))
ctx.setLineWidth(2)
ctx.setLineDash(phase: 0, lengths: [7, 5])
let arrowPath = CGMutablePath()
arrowPath.move(to: CGPoint(x: 220, y: 205))
arrowPath.addCurve(
  to: CGPoint(x: 430, y: 205),
  control1: CGPoint(x: 290, y: 250),
  control2: CGPoint(x: 360, y: 160)
)
ctx.addPath(arrowPath)
ctx.strokePath()

// Arrow head
ctx.setLineDash(phase: 0, lengths: [])
ctx.setFillColor(CGColor(red: 0.55, green: 0.55, blue: 0.55, alpha: 0.7))
let head = CGMutablePath()
head.move(to: CGPoint(x: 430, y: 205))
head.addLine(to: CGPoint(x: 418, y: 198))
head.addLine(to: CGPoint(x: 418, y: 212))
head.closeSubpath()
ctx.addPath(head)
ctx.fillPath()
ctx.restoreGState()

// Bottom callout card
let card = CGRect(x: 36, y: 24, width: width - 72, height: 54)
let cardPath = CGPath(
  roundedRect: card,
  cornerWidth: 12,
  cornerHeight: 12,
  transform: nil
)
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.82))
ctx.addPath(cardPath)
ctx.fillPath()
ctx.setStrokeColor(CGColor(red: 0, green: 0.48, blue: 1, alpha: 0.25))
ctx.setLineWidth(1)
ctx.addPath(cardPath)
ctx.strokePath()

let calloutTitle: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 13, weight: .semibold),
  .foregroundColor: NSColor(calibratedRed: 0, green: 0.48, blue: 1, alpha: 1),
]
("Recommended: double-click Install Beacon" as NSString).draw(
  at: CGPoint(x: 52, y: 52),
  withAttributes: calloutTitle
)

let calloutBody: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 11, weight: .regular),
  .foregroundColor: NSColor(calibratedWhite: 0.4, alpha: 1),
]
("Clears the Mac security block automatically" as NSString).draw(
  at: CGPoint(x: 52, y: 34),
  withAttributes: calloutBody
)

// Legend dots
struct LegendItem {
  let r: CGFloat
  let g: CGFloat
  let b: CGFloat
  let label: String
}
let legend = [
  LegendItem(r: 0.92, g: 0.55, b: 0.12, label: "Working"),
  LegendItem(r: 0.12, g: 0.68, b: 0.38, label: "Done"),
  LegendItem(r: 0.88, g: 0.18, b: 0.28, label: "Needs you"),
]
var lx: CGFloat = 430
for item in legend {
  let dot = CGRect(x: lx, y: height - 36, width: 8, height: 8)
  ctx.setFillColor(CGColor(red: item.r, green: item.g, blue: item.b, alpha: 1))
  ctx.fillEllipse(in: dot)
  let attrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 10, weight: .medium),
    .foregroundColor: NSColor(calibratedWhite: 0.45, alpha: 1),
  ]
  (item.label as NSString).draw(
    at: CGPoint(x: lx + 12, y: height - 39),
    withAttributes: attrs
  )
  lx += 78
}

image.unlockFocus()

guard
  let tiff = image.tiffRepresentation,
  let rep = NSBitmapImageRep(data: tiff),
  let png = rep.representation(using: .png, properties: [:])
else {
  fputs("Failed to encode PNG\n", stderr)
  exit(1)
}

let url = URL(fileURLWithPath: outPath)
try png.write(to: url)
print("Wrote \(outPath)")
