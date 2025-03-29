
import React, { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface TimerProps {
  seconds: number;
  maxTime: number;
  onComplete?: () => void;
  className?: string;
}

const Timer = ({ seconds, maxTime, onComplete, className }: TimerProps) => {
  const [progressValue, setProgressValue] = useState(100);

  useEffect(() => {
    // Convert remaining seconds to a percentage of the maximum time
    const percentage = (seconds / maxTime) * 100;
    setProgressValue(percentage);
  }, [seconds, maxTime]);

  useEffect(() => {
    if (seconds <= 0 && onComplete) {
      onComplete();
    }
  }, [seconds, onComplete]);

  // Format seconds into MM:SS
  const formatTime = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Determine color based on time remaining
  const getColorClass = () => {
    if (progressValue > 60) return "bg-green-500";
    if (progressValue > 30) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Clock className="mr-2 h-4 w-4" />
          <span className="font-medium">Time Remaining</span>
        </div>
        <span className="font-mono text-lg font-medium">
          {formatTime(seconds)}
        </span>
      </div>
      <Progress 
        value={progressValue} 
        className="h-2 bg-muted"
        indicatorClassName={cn(getColorClass(), "transition-all duration-200")}
      />
    </div>
  );
};

export default Timer;
