#include "common/arm_ex_reader.h"

#include <assert.h>

#define ARM_EXIDX_CANT_UNWIND 0x00000001
#define ARM_EXIDX_COMPACT 0x80000000
#define ARM_EXTBL_OP_FINISH 0xb0
#define ARM_EXIDX_TABLE_LIMIT 32
#define READ_OP() *buf++

namespace arm_ex_reader {

using arm_ex_to_module::ARM_EXIDX_CMD_FINISH;
using arm_ex_to_module::ARM_EXIDX_CMD_DATA_PUSH;
using arm_ex_to_module::ARM_EXIDX_CMD_DATA_POP;
using arm_ex_to_module::ARM_EXIDX_CMD_REG_POP;
using arm_ex_to_module::ARM_EXIDX_CMD_REG_TO_SP;
using arm_ex_to_module::ARM_EXIDX_CMD_VFP_POP;
using arm_ex_to_module::ARM_EXIDX_CMD_WREG_POP;
using arm_ex_to_module::ARM_EXIDX_CMD_WCGR_POP;
using arm_ex_to_module::ARM_EXIDX_CMD_RESERVED;
using arm_ex_to_module::ARM_EXIDX_CMD_REFUSED;
using arm_ex_to_module::exidx_entry;
using arm_ex_to_module::ARM_EXIDX_VFP_SHIFT_16;
using arm_ex_to_module::ARM_EXIDX_VFP_DOUBLE;

//void* Prel31ToAddr(const void* addr) {
//  int32_t offset = *reinterpret_cast<const int32_t*>(addr);
//  offset = ((long)offset << 1) >> 1;
//  return ((char *)addr) + offset;
//}

static void* Prel31ToAddr(const void* addr)
{
  uint32_t offset32 = *reinterpret_cast<const uint32_t*>(addr);
  // sign extend offset32[30:0] to 64 bits -- copy bit 30 to positions
  // 63:31 inclusive.
  uint64_t offset64 = offset32;
  if (offset64 & (1ULL << 30))
    offset64 |= 0xFFFFFFFF80000000ULL;
  else
    offset64 &= 0x000000007FFFFFFFULL;
  return ((char*)addr) + (uintptr_t)offset64;
}

// Extract information from extab entry into buf. If impossible return -1.
int ExceptionTableInfo::ExtabEntryExtract(const struct exidx_entry* entry,
                                          uint8_t* buf) {
  int nbuf = 0;
  uint32_t data = entry->data;
  if (data == ARM_EXIDX_CANT_UNWIND) nbuf = -1;
  else if (data & ARM_EXIDX_COMPACT) {
    buf[nbuf++] = data >> 16;
    buf[nbuf++] = data >> 8;
    buf[nbuf++] = data;
  } else {
      uint32_t* extbl_data = reinterpret_cast<uint32_t*>(Prel31ToAddr(&entry->data));
      data = extbl_data[0];
      unsigned int n_table_words = 0;
      if (data & ARM_EXIDX_COMPACT) {
        int pers = (data >> 24) & 0x0f;
        if (pers == 1 || pers == 2) {
          n_table_words = (data >> 16) & 0xff;
          extbl_data += 1;
        } else buf[nbuf++] = data >> 16;
        buf[nbuf++] = data >> 8;
        buf[nbuf++] = data;
      } else {
           n_table_words = extbl_data[1] >> 24;
           buf[nbuf++] = extbl_data[1] >> 16;
           buf[nbuf++] = extbl_data[1] >> 8;
           buf[nbuf++] = extbl_data[1];
           extbl_data += 2;
        }
      assert (n_table_words <= 5);
      unsigned j;
      for (j = 0; j < n_table_words; j++) {
        data = *extbl_data++;
        buf[nbuf++] = data >> 24;
        buf[nbuf++] = data >> 16;
        buf[nbuf++] = data >> 8;
        buf[nbuf++] = data >> 0;
       }
    }
  if (nbuf > 0 && buf[nbuf - 1] != ARM_EXTBL_OP_FINISH)
    buf[nbuf++] = ARM_EXTBL_OP_FINISH;
  return nbuf;
}

// Decode information from extab entry into command and data.
int ExceptionTableInfo::ExtabEntryDecode(const uint8_t* buf,
                                         uint8_t data_size) {
  const uint8_t* end = buf + data_size;
  int ret;
  struct arm_ex_to_module::extab_data edata;

  assert(buf != NULL);
  assert(data_size > 0);

  while (buf < end) {
    uint8_t op = READ_OP ();
    if ((op & 0xc0) == 0x00) {
      edata.cmd = ARM_EXIDX_CMD_DATA_POP;
      edata.data = (((int)op & 0x3f) << 2) + 4;
    }
    else if ((op & 0xc0) == 0x40) {
     edata.cmd = ARM_EXIDX_CMD_DATA_PUSH;
     edata.data = (((int)op & 0x3f) << 2) + 4;
    }
    else if ((op & 0xf0) == 0x80) {
      uint8_t op2 = READ_OP ();
      if (op == 0x80 && op2 == 0x00) edata.cmd = ARM_EXIDX_CMD_REFUSED;
      else {
        edata.cmd = ARM_EXIDX_CMD_REG_POP;
        edata.data = ((op & 0xf) << 8) | op2;
        edata.data = edata.data << 4;
      }
    }
    else if ((op & 0xf0) == 0x90) {
      if (op == 0x9d || op == 0x9f) edata.cmd = ARM_EXIDX_CMD_RESERVED;
      else {
        edata.cmd = ARM_EXIDX_CMD_REG_TO_SP;
        edata.data = op & 0x0f;
      }
    }
    else if ((op & 0xf0) == 0xa0) {
      unsigned end = (op & 0x07);
      edata.data = (1 << (end + 1)) - 1;
      edata.data = edata.data << 4;
      if (op & 0x08) edata.data |= 1 << 14;
      edata.cmd = ARM_EXIDX_CMD_REG_POP;
    }
    else if (op == ARM_EXTBL_OP_FINISH) {
      edata.cmd = ARM_EXIDX_CMD_FINISH;
      buf = end;
    }
    else if (op == 0xb1) {
      uint8_t op2 = READ_OP ();
      if (op2 == 0 || (op2 & 0xf0)) edata.cmd = ARM_EXIDX_CMD_RESERVED;
      else {
        edata.cmd = ARM_EXIDX_CMD_REG_POP;
        edata.data = op2 & 0x0f;
      }
    }
    else if (op == 0xb2) {
      uint32_t offset = 0;
      uint8_t byte, shift = 0;
      do {
        byte = READ_OP ();
        offset |= (byte & 0x7f) << shift;
        shift += 7;
      } while (byte & 0x80);
      edata.data = offset * 4 + 0x204;
      edata.cmd = ARM_EXIDX_CMD_DATA_POP;
    }
    else if (op == 0xb3 || op == 0xc8 || op == 0xc9) {
      edata.cmd = ARM_EXIDX_CMD_VFP_POP;
      edata.data = READ_OP ();
      if (op == 0xc8) edata.data |= ARM_EXIDX_VFP_SHIFT_16;
      if (op != 0xb3) edata.data |= ARM_EXIDX_VFP_DOUBLE;
    }
    else if ((op & 0xf8) == 0xb8 || (op & 0xf8) == 0xd0) {
      edata.cmd = ARM_EXIDX_CMD_VFP_POP;
      edata.data = 0x80 | (op & 0x07);
      if ((op & 0xf8) == 0xd0) edata.data |= ARM_EXIDX_VFP_DOUBLE;
    }
    else if (op >= 0xc0 && op <= 0xc5) {
      edata.cmd = ARM_EXIDX_CMD_WREG_POP;
      edata.data = 0xa0 | (op & 0x07);
    }
    else if (op == 0xc6) {
      edata.cmd = ARM_EXIDX_CMD_WREG_POP;
      edata.data = READ_OP ();
    }
    else if (op == 0xc7) {
      uint8_t op2 = READ_OP ();
      if (op2 == 0 || (op2 & 0xf0)) edata.cmd = ARM_EXIDX_CMD_RESERVED;
      else {
        edata.cmd = ARM_EXIDX_CMD_WCGR_POP;
        edata.data = op2 & 0x0f;
      }
    }
    else edata.cmd = ARM_EXIDX_CMD_RESERVED;

    ret = handler_->ImproveStackFrame(&edata);
    if (ret < 0) return ret;
  }
  return 0;
}

void ExceptionTableInfo::Start() {
  const struct exidx_entry* start =
      reinterpret_cast<const struct exidx_entry*>(exidx_);
  const struct exidx_entry* end =
      reinterpret_cast<const struct exidx_entry*>(exidx_ + exidx_size_);
  for (const struct exidx_entry* entry = start; entry < end; ++entry) {
    uint8_t buf[ARM_EXIDX_TABLE_LIMIT];
    uint32_t addr = (reinterpret_cast<char*>(Prel31ToAddr(&entry->addr))
                     - mapping_addr_ + loading_addr_) & 0x7fffffff;
    uint32_t next_addr;
    if (entry < end - 1)
      next_addr = (reinterpret_cast<char*>(Prel31ToAddr(&((entry + 1)->addr)))
                   - mapping_addr_ + loading_addr_) & 0x7fffffff;
    else {
        //XXX: how to calculate this? just "size of text section" - addr?
        next_addr = addr;
    }
    handler_->AddStackFrame(addr, next_addr - addr);
    int data_size = ExtabEntryExtract(entry, buf);
    if (data_size < 0) {
      handler_->DeleteStackFrame();
      continue;
    }
    int ret = ExtabEntryDecode(buf, data_size);
    if (ret < 0) {
      handler_->DeleteStackFrame();
      continue;
    }
    handler_->SubmitStackFrame();
  }
}

} // arm_ex_reader
