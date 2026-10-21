// Playwright's macOS headless Chromium defaults to SwiftShader. Explicitly
// exercise the same Metal hardware path available to the desktop browser.
// Recovery tests independently disable/lose WebGL and verify the fallback.
export const renderingLaunchOptions = engine => ({headless:true,
 ...(engine.name()==='chromium'&&process.platform==='darwin'
   ?{args:['--enable-gpu','--use-angle=metal']}:{}),
});
