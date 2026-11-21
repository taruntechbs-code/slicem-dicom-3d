#!/usr/bin/env bash
# ==============================================================================
# SliceM ACDC Cardiac MRI Fine-Tuning on 12 GB NVIDIA GPU
# Target Machine: Linux (Ubuntu 22.04 LTS), 1x NVIDIA RTX 3060 / 4070 / V100 (12 GB VRAM)
# ==============================================================================
set -euo pipefail

echo "=== [SliceM] nnU-Net v2 ACDC Cardiac Fine-Tuning Pipeline ==="

# 1. Hardware & Driver Check
if ! command -v nvidia-smi &> /dev/null; then
    echo "ERROR: nvidia-smi not found. This training script requires an NVIDIA GPU with CUDA."
    exit 1
fi

echo "--- GPU Hardware Status ---"
nvidia-smi --query-gpu=name,driver_version,memory.total,memory.free --format=csv,noheader

# 2. Environment Variables Configuration
export nnUNet_raw="${nnUNet_raw:-$(pwd)/nnUNet_raw}"
export nnUNet_preprocessed="${nnUNet_preprocessed:-$(pwd)/nnUNet_preprocessed}"
export nnUNet_results="${nnUNet_results:-$(pwd)/nnUNet_results}"

# 12 GB GPU memory tuning
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-4}"
export nnUNet_n_proc_DA="${nnUNet_n_proc_DA:-6}"

echo "nnUNet_raw:          $nnUNet_raw"
echo "nnUNet_preprocessed: $nnUNet_preprocessed"
echo "nnUNet_results:      $nnUNet_results"

mkdir -p "$nnUNet_raw" "$nnUNet_preprocessed" "$nnUNet_results"

# 3. Verify Dataset Exists
DATASET_DIR="$nnUNet_raw/Dataset501_ACDC"
if [ ! -d "$DATASET_DIR" ]; then
    echo "ERROR: Dataset directory '$DATASET_DIR' not found."
    echo "Run: python3 scripts/prepare_acdc_nnunet.py --input-dir /path/to/acdc/training --output-dir $DATASET_DIR"
    exit 1
fi

START_TIME=$(date +%s)

# 4. Plan and Preprocess
echo "--- Running nnU-Net v2 Dataset Integrity & Planning ---"
nnUNetv2_plan_and_preprocess -d 501 --verify_dataset_integrity -c 3d_fullres

# 5. Model Training (Fold 0, 3d_fullres)
# Accepts optional flags like --c (continue training) passed as script arguments
echo "--- Launching nnUNetv2_train (Fold 0, 3d_fullres, 12GB VRAM Profile) ---"
echo "Arguments: ${*:-<none>}"

nnUNetv2_train 501 3d_fullres 0 --npz "$@"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "=== Training Finished Successfully ==="
echo "Total Execution Time: $((DURATION / 3600))h $(((DURATION % 3600) / 60))m $((DURATION % 60))s"
echo "Trained weights saved in: $nnUNet_results/Dataset501_ACDC/nnUNetTrainer__nnUNetPlans__3d_fullres/fold_0"
