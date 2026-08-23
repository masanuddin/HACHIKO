"""
HACHIKO — Eksperimen Baseline: Head Pose + EAR Detection
============================================================
Tujuan: ukur FPS baseline dari head-pose + EAR detection (SEBELUM
nambah YOLO object detection), dan liat langsung angka yaw/pitch/EAR
berubah real-time buat ngerasain threshold mana yang natural.

Update: pakai MediaPipe Tasks API (FaceLandmarker) — API baru yang
resmi dipakai Google, gantiin API lama (mp.solutions.face_mesh) yang
udah di-deprecate dan sering error di versi mediapipe terbaru.

Cara jalanin:
    pip install opencv-python mediapipe numpy
    python baseline_detection.py
(Model landmark wajah bakal ke-download otomatis pas pertama kali run,
 sekitar 3-4 MB, cuma sekali doang.)

Kontrol:
    q = keluar
    1 = pake threshold Ma et al. (yaw>30 selama 3 detik)
    2 = pake threshold lebih sensitif (~1 detik)
    b = tandain lagi "baca buku"
    h = tandain lagi "pegang HP"
    n = hapus tanda (normal)

Data logging:
    Setiap run otomatis bikin file log_YYYYMMDD_HHMMSS.csv di folder
    yang sama, isinya time-series yaw/pitch/EAR/status per frame +
    tag yang lagi aktif. Buka pake Excel/Google Sheets buat dianalisis
    atau dilampirin ke paper sebagai bukti proses eksperimen.
"""

import os
import csv
import time
import urllib.request
from collections import deque
from datetime import datetime

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# ── Setup model FaceLandmarker (Tasks API) ───────────────────────
MODEL_PATH = "face_landmarker.task"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)


def ensure_model():
    if not os.path.exists(MODEL_PATH):
        print("Download model face landmarker (sekali doang, ~4MB)...")
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        print("Selesai download.")


# Indeks landmark mata (topologi 468-point, tetap sama di API baru)
RIGHT_EYE = [33, 160, 158, 133, 153, 144]
LEFT_EYE = [362, 385, 387, 263, 373, 380]

# Titik 2D dipakai buat solvePnP (head pose)
POSE_LANDMARKS = [1, 152, 33, 263, 61, 291]  # nose, chin, eye kiri-kanan, mulut kiri-kanan

MODEL_3D_POINTS = np.array([
    (0.0, 0.0, 0.0),          # nose tip
    (0.0, -330.0, -65.0),     # chin
    (-225.0, 170.0, -135.0),  # left eye left corner
    (225.0, 170.0, -135.0),   # right eye right corner
    (-150.0, -150.0, -125.0), # left mouth corner
    (150.0, -150.0, -125.0),  # right mouth corner
], dtype=np.float64)


def calculate_ear(landmarks, eye_indices, w, h):
    """Hitung Eye Aspect Ratio dari 6 titik landmark satu mata."""
    pts = [(landmarks[i].x * w, landmarks[i].y * h) for i in eye_indices]
    p1, p2, p3, p4, p5, p6 = [np.array(p) for p in pts]
    vertical1 = np.linalg.norm(p2 - p6)
    vertical2 = np.linalg.norm(p3 - p5)
    horizontal = np.linalg.norm(p1 - p4)
    if horizontal == 0:
        return 0.0
    return (vertical1 + vertical2) / (2.0 * horizontal)


def get_head_pose(landmarks, w, h):
    """Hitung yaw & pitch (derajat) pakai solvePnP."""
    image_points = np.array(
        [(landmarks[i].x * w, landmarks[i].y * h) for i in POSE_LANDMARKS],
        dtype=np.float64,
    )
    focal_length = w
    center = (w / 2, h / 2)
    camera_matrix = np.array([
        [focal_length, 0, center[0]],
        [0, focal_length, center[1]],
        [0, 0, 1],
    ], dtype=np.float64)
    dist_coeffs = np.zeros((4, 1))

    success, rotation_vec, _ = cv2.solvePnP(
        MODEL_3D_POINTS, image_points, camera_matrix, dist_coeffs,
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not success:
        return 0.0, 0.0

    rotation_mat, _ = cv2.Rodrigues(rotation_vec)
    proj_matrix = np.hstack((rotation_mat, np.zeros((3, 1))))
    euler_angles = cv2.decomposeProjectionMatrix(proj_matrix)[6].flatten()
    pitch, yaw, _ = [float(a) for a in euler_angles]
    return yaw, pitch


def main():
    ensure_model()

    base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
    options = mp_vision.FaceLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    landmarker = mp_vision.FaceLandmarker.create_from_options(options)

    cap = cv2.VideoCapture(0)

    thresholds = {
        1: {"label": "Ma et al. (2s eye / 3s yaw)", "yaw_dur": 3.0, "ear_dur": 2.0},
        2: {"label": "Sensitif (~1 detik)", "yaw_dur": 1.0, "ear_dur": 1.0},
    }
    active = 1

    yaw_threshold_deg = 30.0
    ear_threshold = 0.21  # titik awal umum di literatur EAR, kalibrasi sendiri nanti

    distracted_since = None
    eyes_closed_since = None
    current_tag = ""
    fps_times = deque(maxlen=30)
    start_time = time.time()

    log_filename = f"log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    log_file = open(log_filename, "w", newline="", encoding="utf-8")
    log_writer = csv.writer(log_file)
    log_writer.writerow([
        "timestamp", "elapsed_sec", "yaw", "pitch", "ear",
        "status", "threshold_mode", "tag",
    ])
    print(f"Logging data ke: {log_filename}")

    while cap.isOpened():
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)
        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        t0 = time.time()
        timestamp_ms = int((time.time() - start_time) * 1000)
        result = landmarker.detect_for_video(mp_image, timestamp_ms)
        status = "Tidak Hadir"
        yaw = pitch = ear = None

        if result.face_landmarks:
            landmarks = result.face_landmarks[0]

            yaw, pitch = get_head_pose(landmarks, w, h)
            ear_r = calculate_ear(landmarks, RIGHT_EYE, w, h)
            ear_l = calculate_ear(landmarks, LEFT_EYE, w, h)
            ear = (ear_r + ear_l) / 2.0

            now = time.time()
            cfg = thresholds[active]

            if abs(yaw) > yaw_threshold_deg:
                distracted_since = distracted_since or now
            else:
                distracted_since = None

            if ear < ear_threshold:
                eyes_closed_since = eyes_closed_since or now
            else:
                eyes_closed_since = None

            is_yaw_distracted = (
                distracted_since is not None
                and (now - distracted_since) >= cfg["yaw_dur"]
            )
            is_eyes_closed = (
                eyes_closed_since is not None
                and (now - eyes_closed_since) >= cfg["ear_dur"]
            )

            status = "Teralih" if (is_yaw_distracted or is_eyes_closed) else "Fokus"

            cv2.putText(frame, f"Yaw: {yaw:.1f} deg", (10, 60),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
            cv2.putText(frame, f"Pitch: {pitch:.1f} deg", (10, 90),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
            cv2.putText(frame, f"EAR: {ear:.3f}", (10, 120),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
        else:
            distracted_since = None
            eyes_closed_since = None

        fps_times.append(time.time() - t0)
        fps = 1.0 / (sum(fps_times) / len(fps_times)) if fps_times else 0.0

        color = (0, 255, 0) if status == "Fokus" else (0, 165, 255) if status == "Teralih" else (0, 0, 255)
        cv2.putText(frame, f"Status: {status}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
        cv2.putText(frame, f"FPS: {fps:.1f}", (10, h - 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.putText(frame, f"Threshold aktif: {thresholds[active]['label']} (tekan 1/2 buat ganti)",
                    (10, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        if current_tag:
            cv2.putText(frame, f"Tag: {current_tag} (n = hapus)", (10, h - 80),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

        log_writer.writerow([
            datetime.now().isoformat(timespec="milliseconds"),
            round(time.time() - start_time, 3),
            round(yaw, 2) if yaw is not None else "",
            round(pitch, 2) if pitch is not None else "",
            round(ear, 4) if ear is not None else "",
            status,
            thresholds[active]["label"],
            current_tag,
        ])

        cv2.imshow("HACHIKO - Baseline Detection", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("1"):
            active = 1
        elif key == ord("2"):
            active = 2
        elif key == ord("b"):
            current_tag = "baca_buku"
        elif key == ord("h"):
            current_tag = "pegang_hp"
        elif key == ord("n"):
            current_tag = ""

    cap.release()
    cv2.destroyAllWindows()
    landmarker.close()
    log_file.close()
    print(f"Data tersimpan di: {log_filename}")


if __name__ == "__main__":
    main()
