#include "common/arm_ex_to_module.h"

#include <stdio.h>
#include <assert.h>

#define ARM_EXBUF_START(x) (((x) >> 4) & 0x0f)
#define ARM_EXBUF_COUNT(x) ((x) & 0x0f)
#define ARM_EXBUF_END(x) (ARM_EXBUF_START(x) + ARM_EXBUF_COUNT(x))

namespace arm_ex_to_module {

// Translate command from extab_data to command for Module.
int ARMExToModule::TranslateCmd(const struct extab_data *edata, Module::StackFrameEntry *entry, string& vsp) {
  int ret = 0;
  unsigned i;
  switch (edata->cmd) {
    case ARM_EXIDX_CMD_FINISH:
      /* Set LR to PC if not set already. */
      if (entry->initial_rules.find("pc") == entry->initial_rules.end()) {
        if (entry->initial_rules.find("lr") == entry->initial_rules.end())
          entry->initial_rules["pc"] = "lr";
        else entry->initial_rules["pc"] = entry->initial_rules["lr"];
      }
      break;
    case ARM_EXIDX_CMD_DATA_PUSH:
      {
        char c[16];
        sprintf(c, " %d -", edata->data);
        vsp += c;
      }
      break;
    case ARM_EXIDX_CMD_DATA_POP:
      {
        char c[16];
        sprintf(c, " %d +", edata->data);
        vsp += c;
      }
      break;
    case ARM_EXIDX_CMD_REG_POP:
      for (i = 0; i < 16; i++)
        if (edata->data & (1 << i)) {
          entry->initial_rules[regnames[i]] = vsp + " ^";
          vsp += " 4 +";
        }
      /* Set cfa in case the SP got popped. */
      if (edata->data & (1 << 13)) vsp = entry->initial_rules["sp"];
      break;
    case ARM_EXIDX_CMD_REG_TO_SP:
      assert (edata->data < 16);
      if (entry->initial_rules.find(regnames[edata->data]) == entry->initial_rules.end())
        entry->initial_rules["sp"] = regnames[edata->data];
      else entry->initial_rules["sp"] = entry->initial_rules[regnames[edata->data]];
      vsp = entry->initial_rules["sp"];
      break;
    case ARM_EXIDX_CMD_VFP_POP:
      /* Skip VFP registers, but be sure to adjust stack */
      for (i = ARM_EXBUF_START (edata->data); i <= ARM_EXBUF_END (edata->data); i++)
        vsp += " 8 +";
      if (!(edata->data & ARM_EXIDX_VFP_DOUBLE)) vsp += " 4 +";
      break;
    case ARM_EXIDX_CMD_WREG_POP:
      for (i = ARM_EXBUF_START (edata->data); i <= ARM_EXBUF_END (edata->data); i++)
        vsp += " 8 +";
      break;
    case ARM_EXIDX_CMD_WCGR_POP:
      for (i = 0; i < 4; i++)
        if (edata->data & (1 << i)) vsp += " 4 +";
      break;
    case ARM_EXIDX_CMD_REFUSED:
    case ARM_EXIDX_CMD_RESERVED:
      ret = -1;
      break;
  }
  return ret;
}

void ARMExToModule::AddStackFrame(uintptr_t addr, size_t size) {
  stack_frame_entry_ = new Module::StackFrameEntry;
  stack_frame_entry_->address = addr;
  stack_frame_entry_->size = size;
  stack_frame_entry_->initial_rules[kCFA] = "sp";
  vsp_ = "sp";
}

int ARMExToModule::ImproveStackFrame(const struct extab_data *edata) {
  return TranslateCmd(edata, stack_frame_entry_, vsp_) ;
}

void ARMExToModule::DeleteStackFrame() {
  delete stack_frame_entry_;
}

void ARMExToModule::SubmitStackFrame() {
  // return address always winds up in pc
  stack_frame_entry_->initial_rules[kRA] = stack_frame_entry_->initial_rules["pc"];
  // the final value of vsp is the new value of sp
  stack_frame_entry_->initial_rules["sp"] = vsp_;
  module_->AddStackFrameEntry(stack_frame_entry_);
}

} // namespace arm_ex_to_module
