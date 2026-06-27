/* Copyright (c) 2013-2016 Jeffrey Pfau
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "core/core.h"
#include "core/serialize.h"
#include "gba/core.h"
#include "gba/video.h"
#include "util/vfs.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#define WEB_FRAMEBUFFER_STRIDE 256

static struct mCore* webCore;
static struct VFile* webRom;
static color_t webFramebuffer[WEB_FRAMEBUFFER_STRIDE * VIDEO_VERTICAL_PIXELS];
static uint32_t webKeys;

static void webDestroyCore(void) {
	if (webCore) {
		if (webCore->unloadROM) {
			webCore->unloadROM(webCore);
		}
		webCore->deinit(webCore);
		free(webCore);
		webCore = 0;
	}
	if (webRom) {
		webRom->close(webRom);
		webRom = 0;
	}
	webKeys = 0;
}

EMSCRIPTEN_KEEPALIVE
int mgba_web_load_rom(const uint8_t* rom, size_t romSize) {
	if (!rom || !romSize) {
		return 0;
	}

	webDestroyCore();

	webRom = VFileFromConstMemory(rom, romSize);
	if (!webRom) {
		return 0;
	}

	webCore = GBACoreCreate();
	if (!webCore || !webCore->init(webCore)) {
		webDestroyCore();
		return 0;
	}

	mCoreInitConfig(webCore, "web");
	webCore->opts.useBios = false;
	webCore->opts.skipBios = true;
	webCore->setVideoBuffer(webCore, webFramebuffer, WEB_FRAMEBUFFER_STRIDE);

	if (!webCore->loadROM(webCore, webRom)) {
		webDestroyCore();
		return 0;
	}

	webCore->reset(webCore);
	return 1;
}

EMSCRIPTEN_KEEPALIVE
void mgba_web_unload(void) {
	webDestroyCore();
}

EMSCRIPTEN_KEEPALIVE
int mgba_web_is_loaded(void) {
	return webCore ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void mgba_web_reset(void) {
	if (webCore) {
		webCore->reset(webCore);
	}
}

EMSCRIPTEN_KEEPALIVE
void mgba_web_run_frame(void) {
	if (!webCore) {
		return;
	}
	webCore->setKeys(webCore, webKeys);
	webCore->runFrame(webCore);
}

EMSCRIPTEN_KEEPALIVE
void mgba_web_set_keys(uint32_t keys) {
	webKeys = keys;
	if (webCore) {
		webCore->setKeys(webCore, webKeys);
	}
}

EMSCRIPTEN_KEEPALIVE
uint16_t* mgba_web_framebuffer(void) {
	return webFramebuffer;
}

EMSCRIPTEN_KEEPALIVE
int mgba_web_framebuffer_width(void) {
	return VIDEO_HORIZONTAL_PIXELS;
}

EMSCRIPTEN_KEEPALIVE
int mgba_web_framebuffer_height(void) {
	return VIDEO_VERTICAL_PIXELS;
}

EMSCRIPTEN_KEEPALIVE
int mgba_web_framebuffer_stride(void) {
	return WEB_FRAMEBUFFER_STRIDE;
}

EMSCRIPTEN_KEEPALIVE
size_t mgba_web_state_size(void) {
	return webCore ? webCore->stateSize(webCore) : 0;
}

EMSCRIPTEN_KEEPALIVE
int mgba_web_save_state(uint8_t* out, size_t outSize) {
	if (!webCore || !out || outSize < webCore->stateSize(webCore)) {
		return 0;
	}
	return webCore->saveState(webCore, out) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int mgba_web_load_state(const uint8_t* state, size_t stateSize) {
	if (!webCore || !state || stateSize < webCore->stateSize(webCore)) {
		return 0;
	}
	return webCore->loadState(webCore, state) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
size_t mgba_web_save_size(void) {
	void* sram = 0;
	size_t size = webCore ? webCore->savedataClone(webCore, &sram) : 0;
	free(sram);
	return size;
}

EMSCRIPTEN_KEEPALIVE
size_t mgba_web_save_data(uint8_t* out, size_t outSize) {
	void* sram = 0;
	size_t size = webCore ? webCore->savedataClone(webCore, &sram) : 0;
	if (!size || !sram || !out || outSize < size) {
		free(sram);
		return 0;
	}
	memcpy(out, sram, size);
	free(sram);
	return size;
}

EMSCRIPTEN_KEEPALIVE
int mgba_web_load_save(const uint8_t* data, size_t size) {
	if (!webCore || !data || !size) {
		return 0;
	}
	return webCore->savedataRestore(webCore, data, size, true) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int mgba_web_frame_counter(void) {
	return webCore ? webCore->frameCounter(webCore) : 0;
}
