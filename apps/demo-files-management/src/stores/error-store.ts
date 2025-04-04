import { ref } from "vue";
import { v4 } from "uuid";
export interface UIError {
  id: string;
  message: string;
  timestamp: number;
  componentId?: string;
  details?: unknown;
}

const errors = ref<UIError[]>([]);

export function useErrorStore() {
  function addError(message: string, details?: unknown, componentId?: string) {
    const error: UIError = {
      id: v4(),
      message,
      timestamp: Date.now(),
      componentId,
      details
    };

    errors.value.push(error);
  }

  function removeError(id: string) {
    errors.value = errors.value.filter((error) => error.id !== id);
  }

  function clearErrors(componentId?: string) {
    if (componentId) {
      errors.value = errors.value.filter((error) => error.componentId !== componentId);
    } else {
      errors.value = [];
    }
  }

  return {
    errors,
    addError,
    removeError,
    clearErrors
  };
}
