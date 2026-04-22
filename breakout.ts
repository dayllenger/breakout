import * as easing from "./easing.js"

type Vec2 = {
    x: number
    y: number
}

type Rect = {
    x: number
    y: number
    w: number
    h: number
}

type Particle = {
    x: number
    y: number
    vx: number
    vy: number
    size: number
}

type Sound = {
    buffer: AudioBuffer | null
}

const cvs = document.createElement("canvas")
const ctx = cvs.getContext("2d")!

const vw = Math.min(window.innerWidth, 400)
const vh = Math.max(window.innerHeight, 500)
cvs.style.width = vw + "px"
cvs.style.height = vh + "px"
cvs.width = vw * window.devicePixelRatio
cvs.height = vh * window.devicePixelRatio

document.body.appendChild(cvs)

const sounds: Record<string, Sound> = {
    over: { buffer: null },
    pick: { buffer: null },
    plick: { buffer: null },
    poom: { buffer: null },
}
const audio_ctx = new AudioContext()
let did_click = false

for (const name in sounds) {
    fetch(name + ".mp3")
        .then((r) => r.arrayBuffer())
        .then((arrbuf) =>
            audio_ctx.decodeAudioData(arrbuf, (buf) => (sounds[name as keyof typeof sounds].buffer = buf)),
        )
        .catch((e) => console.error(e))
}

function play_sound(sound: Sound): void {
    if (sound.buffer) {
        const source = audio_ctx.createBufferSource()
        source.buffer = sound.buffer
        source.connect(audio_ctx.destination)
        source.start()
    }
}

const BLOCKS_H = 8
const BLOCKS_V = 8
const PLATFORM_W = 100
const PLATFORM_H = 20
const BALL_RADIUS = 10

let blocks_taken: Uint8Array[] = []
let speed = 250

for (let y = 0; y < BLOCKS_V; y++) {
    blocks_taken.push(new Uint8Array(BLOCKS_H))
}

function collide_with(rect: Rect, ball: Rect, center: Vec2, dir: Vec2, dt: number): boolean {
    if (rect.x + rect.w < ball.x || ball.x + ball.w < rect.x || rect.y + rect.h < ball.y || ball.y + ball.h < rect.y)
        return false

    const xl = center.x - rect.x
    const xr = center.x - rect.x - rect.w
    const yt = center.y - rect.y
    const yb = center.y - rect.y - rect.h

    const l = xl <= 0 && yt >= xl && yb < -xl
    const r = xr >= 0 && yt >= -xr && yb < xr
    const t = yt <= 0 && yt < xl && yt < -xr
    const b = yb >= 0 && yb >= -xl && yb >= xr

    if ((l && dir.x > 0) || (r && dir.x < 0)) dir.x = -dir.x
    if ((t && dir.y > 0) || (b && dir.y < 0)) dir.y = -dir.y
    center.x += dir.x * speed * dt
    center.y += dir.y * speed * dt

    return true
}

let ts_prev: number | undefined
let started = false
const keys_down = { left: false, right: false }
const pointer = { touches: new Set(), x: 0, y: 0 }
const platform_pos = { x: 0, y: 0 }
let platform_speed = 0
const ball_pos = { x: 0, y: 0 }
const ball_dir = { x: 0, y: 0 }
let lost = false
let total_score = 0

let offset_anim = 0
let ball_anim = 0
let score_anim = 0
let touched_platform_anim = 0

const particles: Particle[] = []

function spawn_particles(x: number, y: number, count: number, size: number = 5): void {
    for (let i = 0; i < count; i++) {
        particles.push({
            x,
            y,
            vx: Math.random() * 200 - 100,
            vy: Math.random() * 200 - 100,
            size: Math.random() * size,
        })
    }
}

function main_loop(timestamp: number): void {
    if (ts_prev === undefined) {
        ts_prev = 0
        platform_pos.x = (vw - PLATFORM_W) / 2
        platform_pos.y = vh - PLATFORM_H - 40
        ball_pos.x = platform_pos.x + PLATFORM_W / 2
        ball_pos.y = platform_pos.y - BALL_RADIUS
        ball_dir.y = -1
    }
    const dt = (timestamp - ts_prev) / 1000
    ts_prev = timestamp
    if (dt > 0.05) {
        requestAnimationFrame(main_loop)
        return // skip when tab is hidden
    }

    let pressed_dir = 0
    if (pointer.touches.size > 0) {
        pressed_dir = pointer.x < vw / 2 ? -1 : 1
    } else {
        if (keys_down.left) pressed_dir = -1
        if (keys_down.right) pressed_dir = 1
    }
    if (pressed_dir !== 0) {
        if (!started) {
            started = true
            ball_dir.x = pressed_dir
        }
        platform_speed += pressed_dir * 12 * (300 + speed) * dt
    }
    platform_pos.x += platform_speed * dt
    platform_speed -= platform_speed * 15 * dt // friction

    let platform_scale_diff = Math.abs(platform_speed) / 2000
    const overflow_left = 5 - platform_pos.x
    const overflow_right = platform_pos.x + PLATFORM_W - (vw - 5)
    if (overflow_left > 0) {
        platform_speed += overflow_left * (300 + speed) * dt
        platform_scale_diff -= overflow_left / 70
    }
    if (overflow_right > 0) {
        platform_speed -= overflow_right * (300 + speed) * dt
        platform_scale_diff -= overflow_right / 70
    }

    if (started) {
        ball_pos.x += ball_dir.x * speed * dt
        ball_pos.y += ball_dir.y * speed * dt

        const ball = {
            x: ball_pos.x - BALL_RADIUS,
            y: ball_pos.y - BALL_RADIUS,
            w: BALL_RADIUS * 2,
            h: BALL_RADIUS * 2,
        }

        // platform
        const platform = { x: platform_pos.x, y: platform_pos.y, w: PLATFORM_W, h: PLATFORM_H }
        if (collide_with(platform, ball, ball_pos, ball_dir, dt)) {
            ball_anim = 0.2
            touched_platform_anim = 0.2
            ball_dir.x += platform_speed / 1000
            spawn_particles(ball_pos.x, ball_pos.y, 10)
            play_sound(sounds.poom)
        }

        // bricks
        const brick = { x: 0, y: 0, w: 0, h: 0 }
        let collected = 0
        let collected_before = 0

        for (let y = 0; y < BLOCKS_V; y++) {
            const w = vw / BLOCKS_H
            brick.w = w - 5
            brick.h = 20
            for (let x = 0; x < BLOCKS_H; x++) {
                if (!blocks_taken[y][x]) {
                    brick.x = 2.5 + x * w
                    brick.y = 60 + y * 25
                    if (collide_with(brick, ball, ball_pos, ball_dir, dt)) {
                        blocks_taken[y][x] = 1
                        speed += 5
                        score_anim = ball_anim = 0.2
                        spawn_particles(ball_pos.x, ball_pos.y, 10, 5 + collected * 10)
                        collected++
                        total_score++
                    }
                } else {
                    collected_before++
                }
            }
        }

        if (collected > 0) {
            play_sound(sounds.plick)
            if (collected > 1) {
                play_sound(sounds.pick)
            }
            // restart
            if (collected + collected_before === BLOCKS_V * BLOCKS_H) {
                setTimeout(() => {
                    for (let y = 0; y < BLOCKS_V; y++) {
                        for (let x = 0; x < BLOCKS_H; x++) {
                            blocks_taken[y][x] = 0
                        }
                    }
                    offset_anim = 0
                }, 1000)
            }
        }

        // walls
        if (ball_pos.y > vh - BALL_RADIUS) {
            if (!lost) {
                lost = true
                ball_dir.x = 0
                score_anim = 0.2
                play_sound(sounds.over)
                total_score -= 5

                setTimeout(() => {
                    ts_prev = undefined
                    started = false
                    lost = false
                }, 1000)
            }
        } else if (ball_pos.y < BALL_RADIUS) {
            ball_dir.y = Math.abs(ball_dir.y)
            ball_anim = 0.2
            spawn_particles(ball_pos.x, ball_pos.y, 10)
            play_sound(sounds.poom)
        } else if (ball_pos.x < BALL_RADIUS) {
            ball_dir.x = Math.abs(ball_dir.x)
            ball_anim = 0.2
            spawn_particles(ball_pos.x, ball_pos.y, 10)
            play_sound(sounds.poom)
        } else if (ball_pos.x > vw - BALL_RADIUS) {
            ball_dir.x = -Math.abs(ball_dir.x)
            ball_anim = 0.2
            spawn_particles(ball_pos.x, ball_pos.y, 10)
            play_sound(sounds.poom)
        }
    }

    // --- drawing ---

    ctx.resetTransform()
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    ctx.clearRect(0, 0, vw, vh)

    for (let i = 0; i < particles.length; ) {
        // update
        particles[i].x += particles[i].vx * dt
        particles[i].y += particles[i].vy * dt
        particles[i].size *= 0.9
        // delete the dead
        if (particles[i].size < 0.01) {
            particles[i] = particles.at(-1)!
            particles.pop()
        } else {
            i++
        }
    }
    // draw particles behind solid objects
    if (particles.length > 0) {
        ctx.fillStyle = "#fff"
        ctx.beginPath()
        for (const p of particles) {
            ctx.moveTo(p.x, p.y)
            ctx.arc(p.x, p.y, p.size, 0, 2 * Math.PI, false)
        }
        ctx.fill()
    }

    // the blocks
    offset_anim += dt
    if (offset_anim > 1.0) offset_anim = 1.0

    ctx.save()
    ctx.translate(0, (easing.easeOutBounce(offset_anim) - 1) * 400)

    for (let y = 0; y < BLOCKS_V; y++) {
        const w = vw / BLOCKS_H
        ctx.fillStyle = `rgba(102,54,255,${(0.2 + (y / BLOCKS_V) * 0.8) * 100}%)`

        for (let x = 0; x < BLOCKS_H; x++) {
            if (!blocks_taken[y][x]) {
                ctx.fillRect(2.5 + x * w, 60 + y * 25, w - 5, 20)
            }
        }
    }
    ctx.restore()

    ball_anim -= dt
    score_anim -= dt
    if (ball_anim < 0) ball_anim = 0
    if (score_anim < 0) score_anim = 0
    // the ball
    ctx.fillStyle = "#2af"
    ctx.beginPath()
    ctx.arc(ball_pos.x, ball_pos.y, BALL_RADIUS + ball_anim * 10, 0, 2 * Math.PI, false)
    ctx.fill()

    // the platform
    ctx.save()
    {
        ctx.translate(platform_pos.x + PLATFORM_W / 2, platform_pos.y + PLATFORM_H / 2)
        ctx.scale(1 + platform_scale_diff, 1 - platform_scale_diff)
        ctx.fillStyle = "#097" // #37f
        ctx.fillRect(-PLATFORM_W / 2, -PLATFORM_H / 2, PLATFORM_W, PLATFORM_H)

        // eyes
        if (Math.sin(timestamp / 1000) < 0.995) {
            ctx.fillStyle = "#fff"
            ctx.beginPath()
            ctx.arc(-PLATFORM_W / 2 + 20, 0, 6, 0, 2 * Math.PI, false)
            ctx.arc(+PLATFORM_W / 2 - 20, 0, 6, 0, 2 * Math.PI, false)
            ctx.fill()

            let dx = ball_pos.x - platform_pos.x + 20
            let dy = ball_pos.y - platform_pos.y + PLATFORM_H / 2
            const len = Math.hypot(dx, dy)
            dx = (2 * dx) / len
            dy = (2 * dy) / len

            ctx.fillStyle = "#000"
            ctx.beginPath()
            ctx.arc(-PLATFORM_W / 2 + 20 + dx, dy, 3, 0, 2 * Math.PI, false)
            ctx.arc(+PLATFORM_W / 2 - 20 + dx, dy, 3, 0, 2 * Math.PI, false)
            ctx.fill()
        }

        touched_platform_anim -= dt
        if (touched_platform_anim < 0) touched_platform_anim = 0

        // mouth
        if (!lost) {
            ctx.scale(1, 0.25 + 3.0 * touched_platform_anim)
        } else {
            ctx.scale(0.5, -1)
            ctx.translate(0, -3)
        }
        ctx.fillStyle = "#333"
        ctx.beginPath()
        ctx.arc(0, -3, 12, 0, Math.PI, false)
        ctx.fill()
    }
    ctx.restore()

    ctx.fillStyle = total_score >= 0 ? "#fff" : "#f26"
    ctx.font = "32px sans"

    ctx.save()
    ctx.scale(1 + score_anim, 1 + score_anim)
    ctx.fillText(String(total_score), 25, 10 + 32)
    ctx.restore()

    if (!did_click) {
        const arrow_y = platform_pos.y + PLATFORM_H / 2
        ctx.fillStyle = "rgba(200,200,200,0.25)"
        const s = 1 + 0.1 * Math.sin(timestamp / 100)
        draw_arrow(vw * 0.25, arrow_y, vw * 0.1 * s, arrow_y)
        draw_arrow(vw * 0.75, arrow_y, vw * (1 - 0.1 * s), arrow_y)

        ctx.fillStyle = "#fff"
        ctx.save()
        const txt = "Tap to begin!"
        const m = ctx.measureText(txt)
        ctx.fillText(txt, (vw - m.width) / 2, vh / 2)
        ctx.restore()
    }

    requestAnimationFrame(main_loop)
}
requestAnimationFrame(main_loop)

function draw_arrow(x0: number, y0: number, x1: number, y1: number) {
    ctx.save()
    ctx.translate(x0, y0)
    ctx.rotate(Math.atan2(y1 - y0, x1 - x0))
    const len = Math.hypot(y1 - y0, x1 - x0)
    const w = Math.min(len / 8, 10)

    ctx.beginPath()
    ctx.moveTo(0, -w)
    ctx.lineTo(len - w * 3, -w)
    ctx.lineTo(len - w * 3, -w * 2)
    ctx.lineTo(len, 0)
    ctx.lineTo(len - w * 3, w * 2)
    ctx.lineTo(len - w * 3, w)
    ctx.lineTo(0, w)
    ctx.closePath()
    ctx.fill()

    ctx.restore()
}

document.addEventListener("keydown", (ev) => {
    if (!did_click) return
    if (ev.key === "ArrowLeft") keys_down.left = true
    if (ev.key === "ArrowRight") keys_down.right = true
})
document.addEventListener("keyup", (ev) => {
    if (ev.key === "ArrowLeft") keys_down.left = false
    if (ev.key === "ArrowRight") keys_down.right = false
})

document.addEventListener("pointerdown", (ev) => {
    if ((ev.buttons & 1) !== 0) {
        did_click = true
        pointer.touches.add(ev.pointerId)
        pointer.x = ev.clientX - cvs.offsetLeft
        pointer.y = ev.clientY - cvs.offsetTop
    }
})
document.addEventListener("pointermove", (ev) => {
    if ((ev.buttons & 1) !== 0) {
        pointer.x = ev.clientX - cvs.offsetLeft
        pointer.y = ev.clientY - cvs.offsetTop
    }
})
document.addEventListener("pointerup", (ev) => {
    pointer.touches.delete(ev.pointerId)
})

// disable vibration on long tap
cvs.addEventListener("touchstart", (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
})
cvs.addEventListener("touchend", (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
})
