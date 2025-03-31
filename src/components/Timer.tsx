import React, { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface TimerProps {
  duration: number;
  isRunning: boolean;
  onComplete?: () => void;
  className?: string;
}

const Timer: React.FC<TimerProps> = ({
  duration,
  isRunning,
  onComplete,
  className
}) => {
  const [timeLeft, setTimeLeft] = useState(duration);
  const [progressValue, setProgressValue] = useState(100);

  useEffect(() => {
    setTimeLeft(duration);
    setProgressValue(100);
  }, [duration]);

  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (isRunning && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          const newTime = prev - 1;
          setProgressValue((newTime / duration) * 100);
          return newTime;
        });
      }, 1000);
    } else if (timeLeft === 0 && onComplete) {
      onComplete();
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isRunning, timeLeft, duration, onComplete]);

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Determine color based on time remaining
  const getColorClass = () => {
    if (progressValue > 60) return "bg-green-500";
    if (progressValue > 30) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className={cn("space-y-2 min-w-[200px]", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Clock className="mr-2 h-4 w-4" />
          <span className="font-medium">Time Remaining</span>
        </div>
        <span className="font-mono text-lg font-medium">
          {formatTime(timeLeft)}
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
