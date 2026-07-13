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

// Apple-style curved arrow between icon centers
let p0 = CGPoint(x: 248, y: 192)
let p1 = CGPoint(x: 300, y: 228)
let p2 = CGPoint(x: 360, y: 156)
let p3 = CGPoint(x: 404, y: 192)

func bezierPoint(
  _ t: CGFloat,
  _ p0: CGPoint,
  _ p1: CGPoint,
  _ p2: CGPoint,
  _ p3: CGPoint
) -> CGPoint {
  let u = 1 - t
  let tt = t * t
  let uu = u * u
  let uuu = uu * u
  let ttt = tt * t
  return CGPoint(
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
  )
}

func bezierTangent(
  _ t: CGFloat,
  _ p0: CGPoint,
  _ p1: CGPoint,
  _ p2: CGPoint,
  _ p3: CGPoint
) -> CGPoint {
  let u = 1 - t
  return CGPoint(
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
  )
}

ctx.saveGState()
let arrowColor = CGColor(red: 0.45, green: 0.45, blue: 0.47, alpha: 0.48)
ctx.setStrokeColor(arrowColor)
ctx.setFillColor(arrowColor)
ctx.setLineWidth(1.5)
ctx.setLineJoin(.round)

let junction = bezierPoint(1, p0, p1, p2, p3)
let tan = bezierTangent(1, p0, p1, p2, p3)
let len = max(hypot(tan.x, tan.y), 0.001)
let ux = tan.x / len
let uy = tan.y / len
let px = -uy
let py = ux

let tipLen: CGFloat = 12
let wingSpread: CGFloat = 5.5
let tip = CGPoint(x: junction.x + ux * tipLen, y: junction.y + uy * tipLen)
let wingA = CGPoint(x: junction.x + px * wingSpread, y: junction.y + py * wingSpread)
let wingB = CGPoint(x: junction.x - px * wingSpread, y: junction.y - py * wingSpread)

// Head first, then shaft with a round cap into the head base
let head = CGMutablePath()
head.move(to: wingA)
head.addLine(to: tip)
head.addLine(to: wingB)
head.closeSubpath()
ctx.addPath(head)
ctx.fillPath()

let shaft = CGMutablePath()
shaft.move(to: p0)
shaft.addCurve(to: junction, control1: p1, control2: p2)
ctx.setLineCap(.round)
ctx.addPath(shaft)
ctx.strokePath()
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
