import React from 'react';
import { UploadCloud, CheckCheck, RefreshCw, Cpu, Box } from 'lucide-react';

export interface StepItem {
  id: number;
  key: 'load' | 'verify' | 'correct' | 'segment' | 'export';
  number: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}

export const STEPS: StepItem[] = [
  {
    id: 1,
    key: 'load',
    number: '01',
    title: '1. Load',
    subtitle: 'DICOM Ingestion',
    icon: <UploadCloud className="w-4 h-4" />,
  },
  {
    id: 2,
    key: 'verify',
    number: '02',
    title: '2. Verify',
    subtitle: 'Geometry & Spacing',
    icon: <CheckCheck className="w-4 h-4" />,
  },
  {
    id: 3,
    key: 'correct',
    number: '03',
    title: '3. Correct',
    subtitle: 'Motion SVR',
    icon: <RefreshCw className="w-4 h-4" />,
  },
  {
    id: 4,
    key: 'segment',
    number: '04',
    title: '4. Segment',
    subtitle: 'Anatomical AI',
    icon: <Cpu className="w-4 h-4" />,
  },
  {
    id: 5,
    key: 'export',
    number: '05',
    title: '5. Inspect & Export',
    subtitle: '3D Meshes & Metrics',
    icon: <Box className="w-4 h-4" />,
  },
];

interface StepperProps {
  currentStep: number;
  onSelectStep: (stepId: number) => void;
}

export const Stepper: React.FC<StepperProps> = ({ currentStep, onSelectStep }) => {
  return (
    <nav aria-label="Pipeline Progress" className="w-full">
      <ol className="grid grid-cols-1 md:grid-cols-5 gap-2 md:gap-0 bg-slate-900/60 p-2 rounded-xl border border-slate-800/80 backdrop-blur-sm">
        {STEPS.map((step, index) => {
          const isActive = currentStep === step.id;
          const isCompleted = currentStep > step.id;

          return (
            <li key={step.id} className="relative flex-1">
              <button
                type="button"
                onClick={() => onSelectStep(step.id)}
                className={`group w-full flex items-center p-3 rounded-lg text-left transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  isActive
                    ? 'bg-slate-800/90 border border-cyan-500/40 shadow-lg shadow-cyan-950/20'
                    : 'hover:bg-slate-800/40 border border-transparent'
                }`}
              >
                {/* Step Icon Badge */}
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-lg text-xs font-mono font-semibold transition-all mr-3 shrink-0 ${
                    isActive
                      ? 'bg-cyan-500 text-slate-950 ring-4 ring-cyan-500/20'
                      : isCompleted
                        ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-400'
                        : 'bg-slate-800 text-slate-400 border border-slate-700/60 group-hover:text-slate-200'
                  }`}
                >
                  {isCompleted ? <CheckCheck className="w-4 h-4" /> : step.icon}
                </div>

                {/* Step Metadata */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-xs font-semibold tracking-wide truncate ${
                        isActive ? 'text-white' : isCompleted ? 'text-slate-200' : 'text-slate-400'
                      }`}
                    >
                      {step.title}
                    </span>
                  </div>
                  <p
                    className={`text-[11px] truncate mt-0.5 ${
                      isActive ? 'text-cyan-300' : 'text-slate-500'
                    }`}
                  >
                    {step.subtitle}
                  </p>
                </div>

                {/* Horizontal Chevron Connector on Desktop */}
                {index < STEPS.length - 1 && (
                  <div
                    aria-hidden="true"
                    className="hidden md:block absolute right-0 top-1/2 -translate-y-1/2 w-px h-6 bg-slate-800 pointer-events-none"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
