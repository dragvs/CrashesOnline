#ifndef COMMON_ARM_EX_READER_H__
#define COMMON_ARM_EX_READER_H__

#include "common/arm_ex_to_module.h"

namespace arm_ex_reader {

// This class is a reader for ARM unwind information
// from .ARM.exidx and .ARM.extab sections.
class ExceptionTableInfo {
 public:
  ExceptionTableInfo(const char* exidx, size_t exidx_size,
                     arm_ex_to_module::ARMExToModule* handler,
                     const char* mapping_addr,
                     uint32_t loading_addr)
      : exidx_(exidx), exidx_size_(exidx_size),
        handler_(handler), mapping_addr_(mapping_addr),
        loading_addr_(loading_addr) { }

  ~ExceptionTableInfo() { }

  // Parses the entries in .ARM.exidx and possibly
  // in .ARM.extab tables, reports what we find to
  // arm_ex_to_module::ARMExToModule.
  void Start();

 private:
  const char* exidx_;
  size_t exidx_size_;
  arm_ex_to_module::ARMExToModule* handler_;
  const char* mapping_addr_;
  uint32_t loading_addr_;
  int ExtabEntryExtract(const struct arm_ex_to_module::exidx_entry* entry,
                        uint8_t* buf);
  int ExtabEntryDecode(const uint8_t* buf, uint8_t data_size);
};

} // namespace arm_ex_reader

#endif // COMMON_ARM_EX_READER_H__
